import { v } from "convex/values";

import { normalizeEmail } from "../../apps/imsg/shared/address";
import { accountStatusKey } from "../../apps/imsg/shared/executors";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, httpAction, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { sealedCredentials } from "../schema/comma/validators";

import { ensureAccount } from "./accounts";
import { publishExecutorStatus } from "./bridgeState";
import { openCredentials, sealCredentials } from "./credentials";
import { GMAIL_API, googleApi, GoogleApiError } from "./gmailApi";
import { markConnection, page, randomHex, siteUrl, STATE_TTL_MS } from "./slackAuth";

/**
 * Connecting a Gmail mailbox as Milad, through Google OAuth with PKCE. Settings asks for Google's consent URL, Google
 * sends the browser back to GET /comma/oauth/google/callback, and the callback exchanges the code for a refresh token
 * and stores it sealed on the mailbox's account row. Access tokens last an hour and are refreshed in Convex when a call
 * needs one. The first mailbox is a Google Workspace one behind an internal OAuth app, whose refresh tokens do not
 * expire on a timer. Setup: apps/imsg/gmail/README.md.
 */

/** Reads mail and labels, and will send and archive in G2. Google classes it as restricted. */
const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
/** Everything Comma asks Google for. The consent screen in the Cloud project lists the same scopes. */
export const GMAIL_SCOPES = ["openid", "email", GMAIL_MODIFY] as const;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Refresh an access token this long before Google says it expires. */
const REFRESH_EARLY_MS = 2 * 60_000;

export const googleRedirectUri = () => `${siteUrl()}/comma/oauth/google/callback`;

function env(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type GmailCredentials = { refreshToken: string; accessToken: string; expiresAt: number };

/** Settings' Connect: Google's consent URL, carrying a single-use state and the PKCE challenge. */
export const startGmailConnect = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const state = randomHex(24);
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    await ctx.runMutation(internal.comma.slackAuth.saveState, { state, platform: "gmail", verifier, expiresAt: Date.now() + STATE_TTL_MS });
    const authorize = new URL(AUTHORIZE_URL);
    authorize.search = new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: googleRedirectUri(), response_type: "code", scope: GMAIL_SCOPES.join(" "),
      // offline and consent: Google returns a refresh token on every connect, a reconnect included.
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state, code_challenge: challenge, code_challenge_method: "S256",
    }).toString();
    return authorize.toString();
  },
});

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

/** GET /comma/oauth/google/callback?code&state: stores the mailbox's refresh token sealed on its account. */
export const handleGoogleCallback = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const saved = state ? await ctx.runMutation(internal.comma.slackAuth.consumeState, { state, platform: "gmail" }) : null;
  if (!saved?.verifier) return page(400, "This link has expired. Start again from Comma's Settings.");
  if (params.get("error") || !code) return page(400, `Gmail didn't connect: ${params.get("error") ?? "no code"}.`);
  try {
    const tokens = await googleApi<TokenResponse>(TOKEN_URL, { form: {
      code, code_verifier: saved.verifier, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: googleRedirectUri(), grant_type: "authorization_code",
    } });
    const granted = new Set((tokens.scope ?? "").split(" "));
    if (!tokens.refresh_token || !granted.has(GMAIL_MODIFY)) {
      return page(403, "Gmail didn't connect: Comma needs to read your mail. Start again and allow it.");
    }
    const profile = await googleApi<{ emailAddress: string }>(`${GMAIL_API}/profile`, { token: tokens.access_token });
    const sendAs = await googleApi<{ sendAs?: { sendAsEmail: string }[] }>(`${GMAIL_API}/settings/sendAs`, { token: tokens.access_token })
      .catch(() => ({ sendAs: [] }));
    const email = normalizeEmail(profile.emailAddress);
    const addresses = [...new Set([email, ...(sendAs.sendAs ?? []).map((alias) => normalizeEmail(alias.sendAsEmail))])].filter(Boolean);
    const credentials: GmailCredentials = {
      refreshToken: tokens.refresh_token, accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await ctx.runMutation(internal.comma.googleAuth.connect, {
      email, selfHandles: addresses, credentials: await sealCredentials(credentials, `gmail:${email}`),
    });
    return page(200, "Gmail is connected. You can close this tab.");
  } catch (error) {
    return page(502, `Gmail didn't connect: ${error instanceof GoogleApiError ? error.code : "an error in Comma"}.`);
  }
});

export const connect = internalMutation({
  args: { email: v.string(), selfHandles: v.array(v.string()), credentials: sealedCredentials },
  returns: v.id("comma_accounts"),
  handler: async (ctx, { email, selfHandles, credentials }) => {
    const { _id } = await ensureAccount(ctx, { platform: "gmail", externalId: email, label: email, selfHandles });
    await ctx.db.patch(_id, { credentials, health: "ok" });
    await markConnection("gmail", ctx, _id, true);
    await ctx.scheduler.runAfter(0, internal.comma.gmailSync.startBackfill, { accountId: _id, resync: false });
    await ctx.scheduler.runAfter(0, internal.comma.gmailSync.watch, { accountId: _id });
    return _id;
  },
});

export const accountCredentials = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.union(v.object({ externalId: v.string(), credentials: v.optional(sealedCredentials) }), v.null()),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    return account?.platform === "gmail" ? { externalId: account.externalId, credentials: account.credentials } : null;
  },
});

export const saveCredentials = internalMutation({
  args: { accountId: v.id("comma_accounts"), credentials: sealedCredentials },
  returns: v.null(),
  handler: async (ctx, { accountId, credentials }) => {
    const account = await ctx.db.get(accountId);
    // A disconnect that landed during the refresh wins.
    if (account?.credentials) await ctx.db.patch(accountId, { credentials, health: "ok" });
    return null;
  },
});

/** Google refused the refresh token (revoked, or the app's access removed): Settings shows Reconnect. */
export const needsReconnect = internalMutation({
  args: { accountId: v.id("comma_accounts"), code: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, code }) => {
    await ctx.db.patch(accountId, { health: "needsAttention" });
    await publishExecutorStatus(ctx, {
      key: accountStatusKey("gmail", accountId), connected: false, lastSeenAt: Date.now(),
      detail: `Google refused the token (${code}). Reconnect Gmail in Settings.`, capabilities: { executor: "gmail" },
    });
    return null;
  },
});

async function openGmail(ctx: Pick<ActionCtx, "runQuery">, accountId: Id<"comma_accounts">): Promise<{ email: string; credentials: GmailCredentials } | null> {
  const account = await ctx.runQuery(internal.comma.googleAuth.accountCredentials, { accountId });
  if (!account?.credentials) return null;
  return { email: account.externalId, credentials: await openCredentials(account.credentials, `gmail:${account.externalId}`) as GmailCredentials };
}

/**
 * A live access token for the mailbox, refreshed when it is about to expire, or null when the mailbox is disconnected
 * or Google refused the refresh. Only actions call this.
 */
export async function gmailToken(ctx: Pick<ActionCtx, "runQuery" | "runMutation">, accountId: Id<"comma_accounts">): Promise<string | null> {
  const opened = await openGmail(ctx, accountId);
  if (!opened) return null;
  const { email, credentials } = opened;
  if (credentials.expiresAt - REFRESH_EARLY_MS > Date.now()) return credentials.accessToken;
  // ponytail: two actions refreshing at once each get a token and the last save wins; both stay valid at Google.
  try {
    const tokens = await googleApi<TokenResponse>(TOKEN_URL, { form: {
      refresh_token: credentials.refreshToken, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), grant_type: "refresh_token",
    } });
    const next: GmailCredentials = {
      refreshToken: tokens.refresh_token ?? credentials.refreshToken, accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await ctx.runMutation(internal.comma.googleAuth.saveCredentials, { accountId, credentials: await sealCredentials(next, `gmail:${email}`) });
    return next.accessToken;
  } catch (error) {
    if (error instanceof GoogleApiError && (error.code === "invalid_grant" || error.code === "unauthorized_client")) {
      await ctx.runMutation(internal.comma.googleAuth.needsReconnect, { accountId, code: error.code });
      return null;
    }
    throw error;
  }
}

/** Settings' Disconnect: revokes the refresh token at Google when it can, and drops it from the row either way. */
export const disconnectGmail = action({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await assertAllowed(ctx);
    const opened = await openGmail(ctx, accountId).catch(() => null);
    const token = opened ? await gmailToken(ctx, accountId).catch(() => null) : null;
    if (token) await googleApi(`${GMAIL_API}/stop`, { token, method: "POST", json: {} }).catch(() => undefined);
    if (opened) await googleApi("https://oauth2.googleapis.com/revoke", { form: { token: opened.credentials.refreshToken } }).catch(() => undefined);
    await ctx.runMutation(internal.comma.googleAuth.disconnect, { accountId });
    return null;
  },
});

export const disconnect = internalMutation({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { credentials: undefined });
    await markConnection("gmail", ctx, accountId, false);
    return null;
  },
});
