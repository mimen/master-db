import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { openCredentials } from "./credentials";
import { ALIAS, FakeGmail, MAILBOX, PUSH_TOPIC, REFRESH_TOKEN, stubGmailEnv } from "./fakeGmail.vitest";
import { GMAIL_SCOPES, gmailToken, TESTING_GRANT_MS } from "./googleAuth";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

let google: FakeGmail;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubGmailEnv();
  google = new FakeGmail().install();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
  return { t, as: t.withIdentity({ subject: `${userId}|session` }) };
}
type T = Awaited<ReturnType<typeof setup>>["t"];

const base64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Settings' Connect, Google's consent (a code bound to the PKCE verifier Convex stored), then the callback. */
async function connect(t: T, as: Awaited<ReturnType<typeof setup>>["as"], { scope = GMAIL_SCOPES.join(" "), verifier, app }: {
  scope?: string; verifier?: string; app?: "workspace" | "personal";
} = {}) {
  const authorize = new URL(await as.action(api.comma.googleAuth.startGmailConnect, app ? { app } : {}));
  const state = authorize.searchParams.get("state")!;
  const stored = await t.run((ctx) => ctx.db.query("comma_oauth_states").collect());
  google.codes.set("good-code", { verifier: verifier ?? stored[0]?.verifier, scope });
  const callback = await t.fetch(`/comma/oauth/google/callback?code=good-code&state=${state}`, { method: "GET" });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { authorize, state, stored, callback };
}

const gmailAccount = (t: T) => t.run((ctx) => ctx.db.query("comma_accounts").withIndex("by_platform_externalId", (q) => q.eq("platform", "gmail")).unique());
/** gmailToken with the test backend as its action context. */
const tokenFor = (t: T, accountId: Id<"comma_accounts">) => gmailToken({
  runQuery: (ref, args) => t.query(ref, args), runMutation: (ref, args) => t.mutation(ref, args),
} as Parameters<typeof gmailToken>[0], accountId);

describe("connecting Gmail", () => {
  test("Connect needs Milad", async () => {
    const { t } = await setup();
    await expect(t.action(api.comma.googleAuth.startGmailConnect, {})).rejects.toThrow("Unauthorized");
  });

  test("Connect opens Google's consent with the scopes, offline access, the redirect and an S256 challenge of the stored verifier", async () => {
    const { t, as } = await setup();
    const authorize = new URL(await as.action(api.comma.googleAuth.startGmailConnect, {}));
    const [stored] = await t.run((ctx) => ctx.db.query("comma_oauth_states").collect());
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stored!.verifier!)));
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      client_id: "google-client-id", redirect_uri: "https://comma.test/comma/oauth/google/callback", response_type: "code",
      scope: "openid email https://www.googleapis.com/auth/gmail.modify", access_type: "offline", prompt: "consent",
      include_granted_scopes: "true", state: stored!.state, code_challenge: challenge, code_challenge_method: "S256",
    });
    expect(stored!.platform).toBe("gmail");
  });

  test("the callback seals the refresh token on the mailbox's account, with its aliases as self handles", async () => {
    const { t, as } = await setup();
    const { callback } = await connect(t, as);
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("Gmail is connected");
    const account = (await gmailAccount(t))!;
    expect(account).toMatchObject({ externalId: MAILBOX, label: MAILBOX, selfHandles: [MAILBOX, ALIAS], health: "ok" });
    expect(await openCredentials(account.credentials!, `gmail:${MAILBOX}`)).toMatchObject({ refreshToken: REFRESH_TOKEN, accessToken: google.accessToken });
    const exchange = google.calls.find((call) => call.form.grant_type === "authorization_code")!;
    expect(exchange.form).toMatchObject({ code: "good-code", redirect_uri: "https://comma.test/comma/oauth/google/callback", client_secret: "google-client-secret" });
    const status = await t.run((ctx) => ctx.db.query("comma_bridge_state").collect());
    expect(status).toEqual([expect.objectContaining({ key: `gmail:${account._id}`, connected: true, capabilities: { executor: "gmail" } })]);
    // Nothing a table holds, nor the accounts list, has a token in plain text.
    const everything = JSON.stringify(await t.run(async (ctx) => [
      await ctx.db.query("comma_accounts").collect(), await ctx.db.query("comma_bridge_state").collect(), await ctx.db.query("comma_oauth_states").collect(),
    ]));
    expect(everything).not.toContain(REFRESH_TOKEN);
    expect(everything).not.toContain(google.accessToken);
    const listed = await as.query(api.comma.accounts.listAccounts, {});
    expect(listed).toEqual([expect.objectContaining({ platform: "gmail", label: MAILBOX, connected: true })]);
    expect(JSON.stringify(listed)).not.toContain("ciphertext");
  });

  test("a state works once, only for Google, and only with its own verifier", async () => {
    const { t, as } = await setup();
    const wrong = await connect(t, as, { verifier: "someone-elses-verifier" });
    expect(wrong.callback.status).toBe(502);
    expect(await gmailAccount(t)).toBeNull();
    const replay = await t.fetch(`/comma/oauth/google/callback?code=good-code&state=${wrong.state}`, { method: "GET" });
    expect(replay.status).toBe(400);
    const slackState = await as.action(api.comma.slackAuth.startSlackConnect, {}).then((url) => new URL(url).searchParams.get("state")!);
    const crossed = await t.fetch(`/comma/oauth/google/callback?code=good-code&state=${slackState}`, { method: "GET" });
    expect(crossed.status).toBe(400);
  });

  test("a consent that leaves out mail access connects nothing", async () => {
    const { t, as } = await setup();
    const { callback } = await connect(t, as, { scope: "openid email" });
    expect(callback.status).toBe(403);
    expect(await gmailAccount(t)).toBeNull();
  });

  test("an expired state is refused", async () => {
    const { t, as } = await setup();
    const authorize = new URL(await as.action(api.comma.googleAuth.startGmailConnect, {}));
    vi.advanceTimersByTime(11 * 60_000);
    const callback = await t.fetch(`/comma/oauth/google/callback?code=good-code&state=${authorize.searchParams.get("state")}`, { method: "GET" });
    expect(callback.status).toBe(400);
  });
});

describe("access tokens", () => {
  test("the stored token serves until it nears expiry, then a refresh replaces it, sealed", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    const account = (await gmailAccount(t))!;
    const first = google.accessToken;
    expect(await tokenFor(t, account._id)).toBe(first);
    vi.advanceTimersByTime(58 * 60_000);
    const refreshed = await tokenFor(t, account._id);
    expect(refreshed).not.toBe(first);
    expect(refreshed).toBe(google.accessToken);
    const sealed = (await gmailAccount(t))!.credentials!;
    expect(JSON.stringify(sealed)).not.toContain(refreshed);
    expect(await openCredentials(sealed, `gmail:${MAILBOX}`)).toMatchObject({ refreshToken: REFRESH_TOKEN, accessToken: refreshed });
    expect(await tokenFor(t, account._id)).toBe(refreshed);
  });

  test("Google refusing the refresh marks the account for reconnecting instead of failing silently", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    const account = (await gmailAccount(t))!;
    google.refreshError = "invalid_grant";
    vi.advanceTimersByTime(60 * 60_000);
    expect(await tokenFor(t, account._id)).toBeNull();
    expect((await gmailAccount(t))!.health).toBe("needsAttention");
    const [status] = await t.run((ctx) => ctx.db.query("comma_bridge_state").collect());
    expect(status).toMatchObject({ connected: false, detail: expect.stringContaining("Reconnect Gmail") });
    const listed = await as.query(api.comma.accounts.listAccounts, {});
    expect(listed[0]).toMatchObject({ health: "needsAttention" });
  });

  test("Disconnect revokes the refresh token and drops it", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    const account = (await gmailAccount(t))!;
    await as.action(api.comma.googleAuth.disconnectGmail, { accountId: account._id });
    expect(google.revokedRefresh).toBe(true);
    expect((await gmailAccount(t))!.credentials).toBeUndefined();
    expect(await tokenFor(t, account._id)).toBeNull();
    await expect(t.action(api.comma.googleAuth.disconnectGmail, { accountId: account._id })).rejects.toThrow("Unauthorized");
  });

  test("the internal credential read never answers for another platform's account", async () => {
    const { t } = await setup();
    const slackId = await t.run((ctx) => ctx.db.insert("comma_accounts", {
      platform: "slack", externalId: "T1", label: "AUF", selfHandles: [], health: "ok", createdAt: 0,
      credentials: { keyVersion: 1, iv: "x", ciphertext: "y" },
    }));
    expect(await t.query(internal.comma.googleAuth.accountCredentials, { accountId: slackId })).toBeNull();
  });
});

describe("a gmail.com mailbox through the personal app", () => {
  const PERSONAL = "miladmaaan@gmail.com";
  const mailbox = (t: T, email: string) => t.run((ctx) => ctx.db.query("comma_accounts")
    .withIndex("by_platform_externalId", (q) => q.eq("platform", "gmail").eq("externalId", email)).unique());

  test("connects through the personal client, refreshes through it, and sits beside the workspace mailbox", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    google.mailbox = PERSONAL;
    const before = Date.now();
    const { authorize, callback } = await connect(t, as, { app: "personal" });
    expect(callback.status).toBe(200);
    expect(authorize.searchParams.get("client_id")).toBe("google-personal-client-id");
    const exchanges = google.calls.filter((call) => call.form.grant_type === "authorization_code");
    expect(exchanges.map((call) => call.form.client_secret)).toEqual(["google-client-secret", "google-personal-client-secret"]);

    const personal = (await mailbox(t, PERSONAL))!;
    const workspace = (await mailbox(t, MAILBOX))!;
    expect(personal.gmailGrant?.app).toBe("personal");
    expect(personal.gmailGrant!.grantedAt).toBeGreaterThanOrEqual(before);
    expect(personal.gmailGrant!.grantedAt).toBeLessThanOrEqual(Date.now());
    expect(workspace.gmailGrant?.app).toBe("workspace");

    vi.advanceTimersByTime(58 * 60_000);
    expect(await tokenFor(t, personal._id)).toBe(google.accessToken);
    expect(await tokenFor(t, workspace._id)).toBe(google.accessToken);
    const refreshes = google.calls.filter((call) => call.form.grant_type === "refresh_token");
    expect(refreshes.map((call) => call.form.client_id)).toEqual(["google-personal-client-id", "google-client-id"]);
  });

  test("the mailbox watches its own app's topic, since Gmail pushes only within the app's project; with none, it waits for the backstop", async () => {
    const { t, as } = await setup();
    google.mailbox = PERSONAL;
    await connect(t, as, { app: "personal" });
    expect(google.watches).toEqual([]);
    vi.stubEnv("GMAIL_PERSONAL_PUSH_TOPIC", "projects/comma-personal/topics/comma-gmail");
    await t.action(internal.comma.gmailSync.renewWatches, {});
    expect(google.watches).toEqual([{ topicName: "projects/comma-personal/topics/comma-gmail" }]);
    expect(google.watches).not.toContainEqual({ topicName: PUSH_TOPIC });
  });

  test("Settings counts down to the weekly reconnect; the workspace mailbox has none", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    google.mailbox = PERSONAL;
    await connect(t, as, { app: "personal" });
    const listed = await as.query(api.comma.accounts.listAccounts, {});
    const { grantedAt } = (await mailbox(t, PERSONAL))!.gmailGrant!;
    expect(listed.find((row) => row.label === PERSONAL)).toMatchObject({ gmailApp: "personal", reconnectBy: grantedAt + TESTING_GRANT_MS });
    const workspace = listed.find((row) => row.label === MAILBOX)!;
    expect(workspace.gmailApp).toBe("workspace");
    expect(workspace).not.toHaveProperty("reconnectBy");
  });

  test("once Google ends the grant, the next backstop shows Reconnect, and reconnecting restarts the countdown", async () => {
    const { t, as } = await setup();
    google.mailbox = PERSONAL;
    await connect(t, as, { app: "personal" });
    const first = (await mailbox(t, PERSONAL))!.gmailGrant!.grantedAt;
    vi.advanceTimersByTime(TESTING_GRANT_MS);
    google.refreshError = "invalid_grant";
    await t.action(internal.comma.gmailSync.backstop, {});
    expect((await mailbox(t, PERSONAL))!.health).toBe("needsAttention");
    expect((await as.query(api.comma.accounts.listAccounts, {}))[0]).toMatchObject({ health: "needsAttention", connected: true });

    google.refreshError = null;
    const { authorize } = await connect(t, as, { app: "personal" });
    expect(authorize.searchParams.get("client_id")).toBe("google-personal-client-id");
    const { grantedAt } = (await mailbox(t, PERSONAL))!.gmailGrant!;
    expect(grantedAt).toBeGreaterThanOrEqual(first + TESTING_GRANT_MS);
    expect((await as.query(api.comma.accounts.listAccounts, {}))[0]).toMatchObject({ health: "ok", reconnectBy: grantedAt + TESTING_GRANT_MS });
  });
});
