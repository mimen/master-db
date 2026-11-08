import { readFileSync } from "node:fs";

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "../_generated/api";
import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { openCredentials, sealCredentials } from "./credentials";
import { FakeSlack, MILAD, stubSlackEnv, TEAM, TOKEN } from "./fakeSlack.vitest";
import { SLACK_USER_SCOPES } from "./slackAuth";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../../apps/imsg/slack/manifest.json", import.meta.url), "utf8")) as {
  oauth_config: { redirect_urls: string[]; scopes: { user: string[]; bot?: string[] } };
  settings: { event_subscriptions?: { request_url: string } };
};

let slack: FakeSlack;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.now() });
  stubSlackEnv();
  slack = new FakeSlack().install();
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

/** Settings' Connect, then the browser's two hops. */
async function connect(t: Awaited<ReturnType<typeof setup>>["t"], as: Awaited<ReturnType<typeof setup>>["as"], code = "good-code") {
  const install = new URL(await as.action(api.comma.slackAuth.startSlackConnect, {}));
  const state = install.searchParams.get("state")!;
  const redirect = await t.fetch(`${install.pathname}${install.search}`, { method: "GET" });
  const callback = await t.fetch(`/comma/oauth/slack/callback?code=${code}&state=${state}`, { method: "GET" });
  // Connecting starts the backfill; let it finish inside the test.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { install, state, redirect, callback };
}

describe("sealed credentials", () => {
  test("open only for the account they were sealed for, under the key version they record", async () => {
    const sealed = await sealCredentials({ token: TOKEN }, "slack:T1");
    expect(JSON.stringify(sealed)).not.toContain(TOKEN);
    expect(sealed.keyVersion).toBe(1);
    expect(await openCredentials(sealed, "slack:T1")).toEqual({ token: TOKEN });
    await expect(openCredentials(sealed, "slack:T2")).rejects.toThrow();
    await expect(openCredentials({ ...sealed, keyVersion: 2 }, "slack:T1")).rejects.toThrow("sealed under key 2");
  });

  test("refuse to run without a well-formed key", async () => {
    vi.stubEnv("COMMA_TOKEN_KEY", "not-a-key");
    await expect(sealCredentials({ token: TOKEN }, "slack:T1")).rejects.toThrow("COMMA_TOKEN_KEY must be");
  });
});

describe("connecting Slack", () => {
  test("Connect needs Milad", async () => {
    const { t } = await setup();
    await expect(t.action(api.comma.slackAuth.startSlackConnect, {})).rejects.toThrow("Unauthorized");
  });

  test("install sends the state to Slack's consent screen for AUF with the manifest's scopes and redirect", async () => {
    const { t, as } = await setup();
    const { install, state, redirect } = await connect(t, as);
    expect(install.origin).toBe("https://comma.test");
    expect(redirect.status).toBe(302);
    const authorize = new URL(redirect.headers.get("Location")!);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://slack.com/oauth/v2/authorize");
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      client_id: "client-id", user_scope: SLACK_USER_SCOPES.join(","), state, team: TEAM.id,
      redirect_uri: "https://comma.test/comma/oauth/slack/callback",
    });
  });

  test("the callback stores the token sealed on the workspace's account, names Milad as self, and reports connected", async () => {
    const { t, as } = await setup();
    const { callback } = await connect(t, as);
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("Slack is connected");
    const [account] = await t.run((ctx) => ctx.db.query("comma_accounts").collect());
    expect(account).toMatchObject({ platform: "slack", externalId: TEAM.id, label: TEAM.name, selfHandles: [`slack:${MILAD}`], health: "ok" });
    expect(await openCredentials(account!.credentials!, `slack:${TEAM.id}`)).toEqual({ token: TOKEN });
    const status = await as.query(api.comma.bridgeState.routeExecutorStatus, { platform: "slack", accountId: account!._id });
    expect(status).toMatchObject({ connected: true, capabilities: { executor: "slack" } });
    const everything = JSON.stringify(await t.run(async (ctx) => [
      await ctx.db.query("comma_accounts").collect(), await ctx.db.query("comma_bridge_state").collect(), await ctx.db.query("comma_oauth_states").collect(),
    ]));
    expect(everything).not.toContain(TOKEN);
    expect(slack.calls.slice(0, 2).map((call) => [call.method, call.token])).toEqual([["oauth.v2.access", null], ["auth.test", TOKEN]]);
  });

  test("a state works once, and an expired or unknown one connects nothing", async () => {
    const { t, as } = await setup();
    const { state } = await connect(t, as);
    const replay = await t.fetch(`/comma/oauth/slack/callback?code=good-code&state=${state}`, { method: "GET" });
    expect(replay.status).toBe(400);
    expect((await t.fetch("/comma/oauth/slack/install?state=nope", { method: "GET" })).status).toBe(400);
    const install = new URL(await as.action(api.comma.slackAuth.startSlackConnect, {}));
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const late = await t.fetch(`/comma/oauth/slack/callback?code=good-code&state=${install.searchParams.get("state")}`, { method: "GET" });
    expect(late.status).toBe(400);
    expect(slack.calls.filter((call) => call.method === "oauth.v2.access")).toHaveLength(1);
  });

  test("a token for another workspace is refused and stored nowhere", async () => {
    const { t, as } = await setup();
    slack.codes.set("other-code", { team: { id: "T999", name: "Elsewhere" }, user: "U9" });
    const { callback } = await connect(t, as, "other-code");
    expect(callback.status).toBe(403);
    expect(await t.run((ctx) => ctx.db.query("comma_accounts").collect())).toEqual([]);
  });

  test("Slack's own refusal reads back as its error code, unescaped input never reaches the page", async () => {
    const { t, as } = await setup();
    const install = new URL(await as.action(api.comma.slackAuth.startSlackConnect, {}));
    const denied = await t.fetch(`/comma/oauth/slack/callback?error=%3Cscript%3E&state=${install.searchParams.get("state")}`, { method: "GET" });
    expect(denied.status).toBe(400);
    expect(await denied.text()).not.toContain("<script>");
  });
});

describe("the accounts list and disconnect", () => {
  test("Settings sees each account's connection and never its credentials", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    const accounts = await as.query(api.comma.accounts.listAccounts, {});
    expect(accounts).toEqual([expect.objectContaining({ platform: "slack", label: "AUF", connected: true, health: "ok" })]);
    expect(Object.keys(accounts[0]!).sort()).toEqual(["_id", "connected", "createdAt", "health", "label", "platform"]);
  });

  test("Disconnect revokes the token at Slack, drops it from the row and reports disconnected", async () => {
    const { t, as } = await setup();
    await connect(t, as);
    const [{ _id: accountId }] = await as.query(api.comma.accounts.listAccounts, {});
    await as.action(api.comma.slackAuth.disconnectSlack, { accountId });
    expect(slack.revoked).toBe(true);
    expect(await as.query(api.comma.accounts.listAccounts, {})).toEqual([expect.objectContaining({ connected: false })]);
    expect((await t.run((ctx) => ctx.db.get(accountId)))?.credentials).toBeUndefined();
    expect(await as.query(api.comma.bridgeState.routeExecutorStatus, { platform: "slack", accountId }))
      .toMatchObject({ connected: false, detail: "Disconnected" });
  });
});

describe("the Slack app manifest", () => {
  test("asks for exactly Comma's user scopes and no bot scopes", () => {
    expect(manifest.oauth_config.scopes.user).toEqual([...SLACK_USER_SCOPES]);
    expect(manifest.oauth_config.scopes.bot ?? []).toEqual([]);
  });

  test("every URL it names is on Comma's production site and routed by convex/http.ts", async () => {
    const { t } = await setup();
    const urls = [...manifest.oauth_config.redirect_urls, ...(manifest.settings.event_subscriptions ? [manifest.settings.event_subscriptions.request_url] : [])];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const { origin, pathname } = new URL(url);
      expect(origin).toBe("https://shiny-gerbil-853.convex.site");
      const method = pathname.includes("/oauth/") ? "GET" : "POST";
      // An unrouted path is the router's 404; a routed one answers on its own terms.
      expect((await t.fetch(pathname, { method })).status, `${method} ${pathname}`).not.toBe(404);
    }
  });
});
