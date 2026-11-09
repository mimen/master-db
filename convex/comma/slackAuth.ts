import { v } from "convex/values";

import { accountStatusKey } from "../../apps/imsg/shared/executors";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, httpAction, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { gmailApp, oauthStateFields, platform, sealedCredentials } from "../schema/comma/validators";

import { ensureAccount } from "./accounts";
import { publishExecutorStatus } from "./bridgeState";
import { openCredentials, sealCredentials } from "./credentials";
import { slackApi, SlackApiError } from "./slackApi";

/**
 * Connecting Comma to Milad's Slack workspace as Milad. Settings asks for a single-use state, the browser opens
 * GET /comma/oauth/slack/install with it, Slack sends the user back to GET /comma/oauth/slack/callback, and the callback
 * exchanges the code for a user token and stores it sealed on the workspace's account row. Token rotation stays off,
 * so a Slack user token never expires and nothing refreshes it. Setup: apps/imsg/slack/README.md.
 */

/** umbrellafriends (AUF). Comma reads one workspace; a token for any other is refused. */
export const SLACK_TEAM_ID = "T066U9Q8F99";

/** What Comma asks to read and write as Milad. `files:write` waits for attachments. */
export const SLACK_USER_SCOPES = [
  "channels:history", "channels:read", "channels:write", "chat:write", "files:read", "files:write", "groups:history",
  "groups:read", "groups:write", "im:history", "im:read", "im:write", "mpim:history", "mpim:read", "mpim:write",
  "reactions:read", "reactions:write", "search:read", "users:read", "users:read.email",
] as const;

export const STATE_TTL_MS = 10 * 60_000;

export function siteUrl(): string {
  const url = process.env.CONVEX_SITE_URL;
  if (!url) throw new Error("CONVEX_SITE_URL is not set");
  return url;
}

const redirectUri = () => `${siteUrl()}/comma/oauth/slack/callback`;

function env(name: "SLACK_CLIENT_ID" | "SLACK_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** What the browser tab shows when the flow ends. */
export function page(status: number, message: string): Response {
  return new Response(`<!doctype html><meta charset="utf-8"><title>Comma</title><p style="font:16px system-ui;margin:40px">${escapeHtml(message)}</p>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Settings' Connect: the install URL, valid for ten minutes and one use. */
export const startSlackConnect = action({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const state = randomHex(24);
    await ctx.runMutation(internal.comma.slackAuth.saveState, { state, platform: "slack", expiresAt: Date.now() + STATE_TTL_MS });
    return `${siteUrl()}/comma/oauth/slack/install?state=${state}`;
  },
});

/** A single-use state for Slack's or Google's connect flow. */
export const saveState = internalMutation({
  args: oauthStateFields,
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("comma_oauth_states", args);
    return null;
  },
});

export const stateIsLive = internalQuery({
  args: { state: v.string(), platform },
  returns: v.boolean(),
  handler: async (ctx, { state, platform }) => {
    const row = await ctx.db.query("comma_oauth_states").withIndex("by_state", (q) => q.eq("state", state)).unique();
    return row !== null && row.platform === platform && row.expiresAt > Date.now();
  },
});

/** The state's row once, while it is live and the platform's; the row goes either way. */
export const consumeState = internalMutation({
  args: { state: v.string(), platform },
  returns: v.union(v.object({ verifier: v.optional(v.string()), gmailApp: v.optional(gmailApp) }), v.null()),
  handler: async (ctx, { state, platform }) => {
    const row = await ctx.db.query("comma_oauth_states").withIndex("by_state", (q) => q.eq("state", state)).unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.platform !== platform || row.expiresAt <= Date.now()) return null;
    return { ...(row.verifier ? { verifier: row.verifier } : {}), ...(row.gmailApp ? { gmailApp: row.gmailApp } : {}) };
  },
});

/** GET /comma/oauth/slack/install?state=…: sends a live state on to Slack's consent screen for the AUF workspace. */
export const handleInstall = httpAction(async (ctx, request) => {
  const state = new URL(request.url).searchParams.get("state");
  if (!state || !(await ctx.runQuery(internal.comma.slackAuth.stateIsLive, { state, platform: "slack" }))) {
    return page(400, "This link has expired. Start again from Comma's Settings.");
  }
  const authorize = new URL("https://slack.com/oauth/v2/authorize");
  authorize.search = new URLSearchParams({
    client_id: env("SLACK_CLIENT_ID"), user_scope: SLACK_USER_SCOPES.join(","), redirect_uri: redirectUri(), state, team: SLACK_TEAM_ID,
  }).toString();
  return new Response(null, { status: 302, headers: { Location: authorize.toString(), "Cache-Control": "no-store" } });
});

type OAuthAccess = { authed_user?: { id: string; scope?: string; access_token?: string }; team?: { id: string; name?: string } };
type AuthTest = { user_id: string; team_id: string; team: string };

/** GET /comma/oauth/slack/callback?code&state: stores Milad's user token sealed on the workspace's account. */
export const handleCallback = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (!state || !(await ctx.runMutation(internal.comma.slackAuth.consumeState, { state, platform: "slack" }))) {
    return page(400, "This link has expired. Start again from Comma's Settings.");
  }
  if (params.get("error") || !code) return page(400, `Slack didn't connect: ${params.get("error") ?? "no code"}.`);
  try {
    const access = await slackApi<OAuthAccess>("oauth.v2.access", {
      client_id: env("SLACK_CLIENT_ID"), client_secret: env("SLACK_CLIENT_SECRET"), code, redirect_uri: redirectUri(),
    });
    const token = access.authed_user?.access_token;
    if (!token || access.team?.id !== SLACK_TEAM_ID) return page(403, "Comma reads only the AUF workspace.");
    const me = await slackApi<AuthTest>("auth.test", {}, token);
    if (me.team_id !== SLACK_TEAM_ID || me.user_id !== access.authed_user?.id) return page(403, "Comma reads only the AUF workspace.");
    const credentials = await sealCredentials({ token }, `slack:${me.team_id}`);
    await ctx.runMutation(internal.comma.slackAuth.connect, {
      externalId: me.team_id, label: access.team.name ?? me.team, selfHandle: `slack:${me.user_id}`, credentials,
    });
    return page(200, "Slack is connected. You can close this tab.");
  } catch (error) {
    return page(502, `Slack didn't connect: ${error instanceof SlackApiError ? error.code : "an error in Comma"}.`);
  }
});

export async function markConnection(platform: "slack" | "gmail", ctx: Parameters<typeof publishExecutorStatus>[0], accountId: Id<"comma_accounts">, connected: boolean) {
  await publishExecutorStatus(ctx, {
    key: accountStatusKey(platform, accountId), connected, lastSeenAt: Date.now(),
    ...(connected ? {} : { detail: "Disconnected" }), capabilities: { executor: platform },
  });
}

export const connect = internalMutation({
  args: { externalId: v.string(), label: v.string(), selfHandle: v.string(), credentials: sealedCredentials },
  returns: v.id("comma_accounts"),
  handler: async (ctx, { selfHandle, credentials, ...account }) => {
    const { _id } = await ensureAccount(ctx, { platform: "slack", ...account, selfHandles: [selfHandle] });
    await ctx.db.patch(_id, { credentials, health: "ok" });
    await markConnection("slack", ctx, _id, true);
    await ctx.scheduler.runAfter(0, internal.comma.slackSync.startBackfill, { accountId: _id });
    return _id;
  },
});

export const accountCredentials = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.union(v.object({ externalId: v.string(), credentials: v.optional(sealedCredentials) }), v.null()),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    return account?.platform === "slack" ? { externalId: account.externalId, credentials: account.credentials } : null;
  },
});

/** The account's user token, or null once it is disconnected. Only actions call this. */
export async function slackToken(ctx: Pick<ActionCtx, "runQuery">, accountId: Id<"comma_accounts">): Promise<string | null> {
  const account = await ctx.runQuery(internal.comma.slackAuth.accountCredentials, { accountId });
  if (!account?.credentials) return null;
  const opened = await openCredentials(account.credentials, `slack:${account.externalId}`);
  return (opened as { token: string }).token;
}

/** Settings' Disconnect: revokes the token at Slack when it can, and drops it from the row either way. */
export const disconnectSlack = action({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await assertAllowed(ctx);
    const token = await slackToken(ctx, accountId).catch(() => null);
    if (token) await slackApi("auth.revoke", {}, token).catch(() => undefined);
    await ctx.runMutation(internal.comma.slackAuth.disconnect, { accountId });
    return null;
  },
});

export const disconnect = internalMutation({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { credentials: undefined });
    await markConnection("slack", ctx, accountId, false);
    return null;
  },
});
