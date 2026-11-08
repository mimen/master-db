import { v } from "convex/values";

import { isPendingGuid } from "../../apps/imsg/shared/pending-send";
import { keyEmoji } from "../../apps/imsg/shared/platform-profile";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "../_generated/server";
import { outboxDoc, slackMessage, type CommandResult, type CommaRoute } from "../schema/comma/validators";

import { slack } from "./conversationIdentity";
import { findMessage } from "./conversationLookup";
import { NotSentError } from "./laneRegistry";
import { MODEL_TEXT_UNSET } from "./messageShape";
import { completePendingSend, refreshLastMessage } from "./pendingSends";
import { messageKey } from "./reactions";
import { applyReaction } from "./reactionStore";
import { slackApi, SlackApiError, type SlackParams } from "./slackApi";
import { slackToken } from "./slackAuth";
import { COMMA_SEND_EVENT, parseSlackMessage, retractSlackMessage, type SlackMessage } from "./slackEvents";
import { slackRefOf, writeSlackBatch } from "./slackSync";

/**
 * The Slack lane: Convex runs each command against Slack's Web API as Milad (laneRegistry.ts). A confirmed command's
 * effect lands at once in applySlackResult, without waiting for Slack's own event. A send whose outcome is unknown is
 * looked for in Slack's history, never posted again.
 */

type OutboxRow = Doc<"comma_outbox">;
type SlackRoute = Extract<CommaRoute, { platform: "slack" }>;

/** Slack codes that may come after Slack acted. Every other error code, a 4xx and a 429 are Slack refusing first. */
const AMBIGUOUS = new Set(["internal_error", "fatal_error", "request_timeout", "service_unavailable"]);

/** One write. `settled` is the code that means Slack already holds what was asked (a reaction it already has). */
async function call<T>(method: string, params: SlackParams, token: string, settled?: string): Promise<T | undefined> {
  try {
    return await slackApi<T>(method, params, token);
  } catch (error) {
    if (!(error instanceof SlackApiError)) throw error;
    if (error.code === settled) return undefined;
    if (AMBIGUOUS.has(error.code) || error.code.startsWith("http_5")) throw error;
    throw new NotSentError(error.message);
  }
}

/** Slack reads `&`, `<` and `>` as markup, so plain text goes out as entities. */
const escapeMrkdwn = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A message id's ts, or a refusal when the id is not this channel's. */
function tsOf(route: SlackRoute, guid: string): string {
  if (!guid.startsWith(`${route.channel}:`)) throw new NotSentError("That message isn't in this conversation");
  return guid.slice(route.channel.length + 1);
}

/** The thread a send goes into: the conversation's own thread, or the message it replies to. */
function sendThread(route: SlackRoute, replyToGuid: string | undefined): string | undefined {
  return route.threadTs ?? (replyToGuid ? tsOf(route, replyToGuid) : undefined);
}

/** The emoji Comma offers, by the name Slack reacts with. Comma refuses any other before calling Slack. */
const OFFERED: Readonly<Record<string, string>> = {
  "👍": "+1", "👎": "-1", "❤️": "heart", "♥️": "hearts", "😂": "joy", "‼️": "bangbang", "❓": "question", "🙏": "pray",
  "🔥": "fire", "🥹": "face_holding_back_tears", "😍": "heart_eyes", "🤣": "rolling_on_the_floor_laughing", "💙": "blue_heart",
  "🫶": "heart_hands", "👌": "ok_hand", "😮": "open_mouth", "😭": "sob", "🎉": "tada", "💯": "100", "👀": "eyes", "✨": "sparkles",
  "🙌": "raised_hands", "😅": "sweat_smile", "🥲": "smiling_face_with_tear", "💀": "skull", "🤝": "handshake", "😘": "kissing_heart",
  "🤔": "thinking_face", "✅": "white_check_mark", "😊": "blush", "👏": "clap", "😢": "cry",
};
const SLACK_EMOJI: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(OFFERED).map(([emoji, name]) => [bare(emoji), name]));

function bare(emoji: string): string {
  return emoji.replace(/️/g, "");
}

export function slackEmojiName(emoji: string): string | undefined {
  return SLACK_EMOJI[bare(emoji)];
}

const SLACK_NAME_EMOJI: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(OFFERED).map(([emoji, name]) => [name, emoji]));

/**
 * What a reaction Slack names shows as: the emoji Comma offers under that name, so Milad's own echo matches the key he
 * sent, skin tone aside; else `:name:`.
 */
export function slackNameEmoji(name: string): string {
  const base = name.split("::")[0]!;
  return SLACK_NAME_EMOJI[base === "thumbsup" ? "+1" : base === "thumbsdown" ? "-1" : base] ?? `:${base}:`;
}

export async function executeSlack(ctx: ActionCtx, row: OutboxRow): Promise<CommandResult> {
  const { route, payload } = row;
  if (route?.platform !== "slack") throw new NotSentError("Not a Slack command");
  const token = await slackToken(ctx, route.accountId).catch(() => null);
  if (!token) throw new NotSentError("Slack is not connected");
  const { channel } = route;
  switch (payload.kind) {
    case "send": {
      const threadTs = sendThread(route, payload.replyToGuid);
      const text = escapeMrkdwn(payload.text);
      const posted = await call<{ ts?: string; message?: unknown }>("chat.postMessage", {
        channel, text, thread_ts: threadTs,
        metadata: JSON.stringify({ event_type: COMMA_SEND_EVENT, event_payload: { clientKey: row.clientKey } }),
      }, token);
      const message = parseSlackMessage(posted?.message);
      const ts = message?.ts ?? posted?.ts;
      if (!ts) throw new Error("Slack confirmed the send without its ts");
      const user = message?.user ?? await ctx.runQuery(internal.comma.slackSync.accountSelf, { accountId: route.accountId });
      const sent = { ...message, ts, user, text: message?.text ?? text, ...(threadTs ? { threadTs } : {}), clientKey: row.clientKey };
      return { kind: "send", guid: slack.messageGuid(channel, ts), slack: sent };
    }
    case "react": {
      const emoji = keyEmoji(payload.reaction);
      const name = emoji ? slackEmojiName(emoji) : undefined;
      if (!name) throw new NotSentError("Slack can't send that reaction");
      await call(payload.remove ? "reactions.remove" : "reactions.add", { channel, timestamp: tsOf(route, payload.messageGuid), name }, token,
        payload.remove ? "no_reaction" : "already_reacted");
      return { kind: "react", ok: true };
    }
    case "edit":
      await call("chat.update", { channel, ts: tsOf(route, payload.messageGuid), text: escapeMrkdwn(payload.text) }, token);
      return { kind: "edit", ok: true };
    case "unsend":
      await call("chat.delete", { channel, ts: tsOf(route, payload.messageGuid) }, token, "message_not_found");
      return { kind: "unsend", ok: true };
    case "markRead": {
      // Slack has no API that marks a thread read, so a thread's read state stays in Comma.
      const ts = route.threadTs || !row.conversationId ? null
        : await ctx.runQuery(internal.comma.slackLane.newestTs, { conversationId: row.conversationId, channel });
      if (ts) await call("conversations.mark", { channel, ts }, token);
      return { kind: "markRead", ok: true };
    }
    default:
      throw new NotSentError(`Slack can't run ${payload.kind}`);
  }
}

export const newestTs = internalQuery({
  args: { conversationId: v.id("comma_conversations"), channel: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { conversationId, channel }) => {
    for await (const message of ctx.db.query("comma_messages")
      .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).order("desc")) {
      if (!isPendingGuid(message.guid) && message.guid.startsWith(`${channel}:`)) return message.guid.slice(channel.length + 1);
    }
    return null;
  },
});

/** A sent message, written as an event would write it, so a reply lands in its thread's conversation as its echo would. */
async function landSlackSend(ctx: MutationCtx, accountId: Id<"comma_accounts">, conversationId: Id<"comma_conversations">, message: SlackMessage) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return;
  await writeSlackBatch(ctx, accountId, [], [{ ref: slackRefOf(conversation), messages: [message] }]);
}

/** What a confirmed Slack command changes in Convex, before Slack's event says so. */
export async function applySlackResult(ctx: MutationCtx, row: OutboxRow): Promise<void> {
  const { route, payload, conversationId, result } = row;
  if (route?.platform !== "slack" || !conversationId) return;
  switch (payload.kind) {
    case "send":
      if (result?.kind === "send" && "slack" in result) await landSlackSend(ctx, route.accountId, conversationId, result.slack);
      return;
    case "react": {
      const emoji = keyEmoji(payload.reaction);
      await applyReaction(ctx, {
        platform: "slack", conversationId, targetKey: messageKey("slack", payload.messageGuid), key: payload.reaction,
        ...(emoji ? { emoji } : {}), isFromMe: true, at: row.createdAt, removed: payload.remove,
      });
      return;
    }
    case "edit": {
      const message = await findMessage(ctx, { platform: "slack", accountId: route.accountId }, payload.messageGuid);
      if (!message) return;
      // The text went out escaped, so it reads back as exactly what was typed, with no mentions or links in it.
      const now = Date.now();
      await ctx.db.patch(message._id, {
        ...MODEL_TEXT_UNSET, ...(message.threadRef ? { threadRef: message.threadRef } : {}),
        text: payload.text, mentions: [], mentionsMe: false, edited: true, dateEdited: now, sourceVersion: now,
      });
      await refreshLastMessage(ctx, message.conversationId);
      return;
    }
    case "unsend":
      await retractSlackMessage(ctx, route.accountId, payload.messageGuid);
      return;
  }
}

// ---- Unknown sends: looked for in Slack at 20 seconds and again at 2 minutes, never posted again. ----

const FIRST_CHECK_MS = 20_000;
const LAST_CHECK_MS = 2 * 60_000;
/** How far before its enqueue a send's message may be dated, for clock skew between Convex and Slack. */
const SKEW_MS = 60_000;

/** Schedules the check for a Slack send that ended unknown. Every other row passes through. */
export async function checkUnknownSend(ctx: MutationCtx, row: OutboxRow): Promise<void> {
  if (row.lane !== "slack" || row.payload.kind !== "send") return;
  await ctx.scheduler.runAfter(FIRST_CHECK_MS, internal.comma.slackLane.findSend, { clientKey: row.clientKey, last: false });
}

export const unknownSend = internalQuery({
  args: { clientKey: v.string() },
  returns: v.union(outboxDoc, v.null()),
  handler: async (ctx, { clientKey }) => {
    const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
    return row?.status === "unknown" ? row : null;
  },
});

/** Milad's messages since the send was queued that could be it: its own clientKey first, then the same text. */
async function candidates(ctx: ActionCtx, row: OutboxRow, route: SlackRoute, text: string, replyToGuid: string | undefined): Promise<SlackMessage[]> {
  const token = await slackToken(ctx, route.accountId);
  if (!token) return [];
  const self = await ctx.runQuery(internal.comma.slackSync.accountSelf, { accountId: route.accountId });
  const threadTs = sendThread(route, replyToGuid);
  const params = { channel: route.channel, oldest: ((row.createdAt - SKEW_MS) / 1000).toFixed(6), include_all_metadata: true, limit: 100 };
  const page = await slackApi<{ messages?: unknown[] }>(threadTs ? "conversations.replies" : "conversations.history",
    threadTs ? { ...params, ts: threadTs } : params, token);
  const mine = (page.messages ?? []).map(parseSlackMessage).filter((message): message is SlackMessage => message?.user === self);
  const sent = escapeMrkdwn(text);
  return [
    ...mine.filter((message) => message.clientKey === row.clientKey),
    ...mine.filter((message) => message.clientKey === undefined && message.text === sent).sort((a, b) => Number(a.ts) - Number(b.ts)),
  ];
}

export const findSend = internalAction({
  args: { clientKey: v.string(), last: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { clientKey, last }) => {
    const row = await ctx.runQuery(internal.comma.slackLane.unknownSend, { clientKey });
    if (row?.route?.platform !== "slack" || row.payload.kind !== "send") return null;
    let found: SlackMessage[] = [];
    try {
      found = await candidates(ctx, row, row.route, row.payload.text, row.payload.replyToGuid);
    } catch {
      // Slack could not be read this time; the next check reads again, and after the last the send stays unknown.
    }
    const landed = found.length > 0 && await ctx.runMutation(internal.comma.slackLane.landFoundSend, { clientKey, candidates: found });
    if (!landed && !last) await ctx.scheduler.runAfter(LAST_CHECK_MS - FIRST_CHECK_MS, internal.comma.slackLane.findSend, { clientKey, last: true });
    return null;
  },
});

/** The first candidate no other send already owns becomes this send's message, and the send is sent. */
export const landFoundSend = internalMutation({
  args: { clientKey: v.string(), candidates: v.array(slackMessage) },
  returns: v.boolean(),
  handler: async (ctx, { clientKey, candidates: found }) => {
    const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
    if (row?.status !== "unknown" || row.route?.platform !== "slack" || !row.conversationId) return false;
    for (const message of found) {
      const guid = slack.messageGuid(row.route.channel, message.ts);
      const owner = await ctx.db.query("comma_outbox").withIndex("by_resultGuid", (q) => q.eq("resultGuid", guid)).first();
      if (owner && owner.clientKey !== clientKey) continue;
      const sent = { ...message, clientKey };
      await ctx.db.patch(row._id, { status: "sent", error: undefined, resultGuid: guid, result: { kind: "send", guid, slack: sent }, updatedAt: Date.now() });
      await landSlackSend(ctx, row.route.accountId, row.conversationId, sent);
      await completePendingSend(ctx, clientKey, "sent", guid);
      return true;
    }
    return false;
  },
});
