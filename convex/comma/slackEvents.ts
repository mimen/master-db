import { v, type Infer } from "convex/values";

import { accountStatusKey } from "../../apps/imsg/shared/executors";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { httpAction, internalMutation, type MutationCtx } from "../_generated/server";
import { jsonResponse } from "../beeper/sync/auth";
import { slackFile, slackMessage, slackUser } from "../schema/comma/validators";

import { publishExecutorStatus } from "./bridgeState";
import { slack, type SlackConversationRef } from "./conversationIdentity";
import { findByKey, findMessage } from "./conversationLookup";
import { MODEL_TEXT_UNSET } from "./messageShape";
import { refreshLastMessage } from "./pendingSends";
import { messageKey } from "./reactions";
import { applyReaction } from "./reactionStore";
import { SLACK_TEAM_ID } from "./slackAuth";
import { slackNameEmoji } from "./slackLane";
import { upsertSlackUsers } from "./slackPeople";
import { countReplies } from "./slackSync";

/**
 * POST /comma/slack/events, Slack's Events API. The handler checks the signature, answers url_verification, and hands
 * each event to `receive`, which drops a repeat, keeps only what `slackRef` qualifies, and schedules the fetch. Slack
 * retries anything slower than three seconds, so nothing here calls Slack.
 */

export type SlackMessage = Infer<typeof slackMessage>;
export type SlackFile = Infer<typeof slackFile>;
export type SlackUser = Infer<typeof slackUser>;

const channelType = v.union(v.literal("im"), v.literal("mpim"), v.literal("channel"), v.literal("group"));
export type SlackChannelType = Infer<typeof channelType>;

const slackEventValue = v.union(
  v.object({ kind: v.literal("message"), channel: v.string(), channelType, message: slackMessage }),
  v.object({ kind: v.literal("deleted"), channel: v.string(), ts: v.string() }),
  v.object({ kind: v.literal("user"), user: slackUser }),
  /** Someone's reaction added or removed, by Slack's emoji name. `at` is the event's time in ms. */
  v.object({ kind: v.literal("reaction"), channel: v.string(), ts: v.string(), user: v.string(), name: v.string(), removed: v.boolean(), at: v.number() }),
);
type SlackEvent = Infer<typeof slackEventValue>;

const MAX_SKEW_SECONDS = 5 * 60;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Slack's v0 signature: HMAC-SHA256 of `v0:<timestamp>:<body>` under the signing secret, within five minutes. */
export async function verifySlackSignature(
  secret: string, headers: { timestamp: string | null; signature: string | null }, body: string, nowSeconds: number,
): Promise<boolean> {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = `v0=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${body}`)))}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The metadata event type a Comma send carries, with its clientKey as the payload, so an unknown send can be found. */
export const COMMA_SEND_EVENT = "comma_send";

/** A message object from an event or a Web API read, or null when it is not a person's message Comma keeps. */
export function parseSlackMessage(raw: unknown): SlackMessage | null {
  if (!isObject(raw)) return null;
  const subtype = text(raw.subtype);
  const user = text(raw.user);
  const ts = text(raw.ts);
  if (!user || !ts || (subtype && !["thread_broadcast", "file_share", "me_message"].includes(subtype))) return null;
  const threadTs = text(raw.thread_ts);
  const editedTs = isObject(raw.edited) ? text(raw.edited.ts) : undefined;
  const sent = isObject(raw.metadata) && raw.metadata.event_type === COMMA_SEND_EVENT && isObject(raw.metadata.event_payload)
    ? text(raw.metadata.event_payload.clientKey) : undefined;
  const files = Array.isArray(raw.files) ? raw.files.flatMap(parseSlackFile) : [];
  return {
    ts, user, text: text(raw.text) ?? "", ...(threadTs ? { threadTs } : {}), ...(editedTs ? { editedTs } : {}), ...(sent ? { clientKey: sent } : {}),
    ...(files.length ? { files } : {}),
  };
}

const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** A deleted file is a tombstone with nothing to show. A Slack Connect file Slack won't share has no URLs. */
function parseSlackFile(raw: unknown): SlackFile[] {
  if (!isObject(raw) || !text(raw.id) || raw.mode === "tombstone") return [];
  const fields = {
    name: text(raw.name) || text(raw.title), mimeType: text(raw.mimetype), size: count(raw.size), width: count(raw.original_w),
    height: count(raw.original_h), url: text(raw.url_private), thumbUrl: text(raw.thumb_720) ?? text(raw.thumb_480) ?? text(raw.thumb_360),
  };
  return [{ id: text(raw.id)!, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) }];
}

/**
 * A user object from `user_change`, `users.info` or `users.list`. The display name wins over the real name, as Slack
 * shows it. Only a picture the user set counts: Slack marks it `is_custom_image`, and its generated default is initials.
 */
export function parseSlackUser(raw: unknown): SlackUser | null {
  if (!isObject(raw) || !text(raw.id)) return null;
  const profile = isObject(raw.profile) ? raw.profile : {};
  const name = text(profile.display_name) || text(profile.real_name) || text(raw.real_name) || text(raw.name) || "Slack user";
  const email = text(profile.email);
  const image = profile.is_custom_image === true ? text(profile.image_192) || text(profile.image_72) : undefined;
  return { id: text(raw.id)!, name, ...(email ? { email } : {}), ...(image ? { image } : {}) };
}

type Payload = { type: "challenge"; challenge: string } | { type: "event"; eventId: string; teamId: string; event: SlackEvent | null };

/** The Events API body, parsed at the boundary. An event Comma does not keep parses as a null event, acknowledged and dropped. */
export function parseSlackPayload(raw: unknown): Payload | null {
  if (!isObject(raw)) return null;
  if (raw.type === "url_verification" && text(raw.challenge)) return { type: "challenge", challenge: text(raw.challenge)! };
  const eventId = text(raw.event_id);
  const teamId = text(raw.team_id);
  if (raw.type !== "event_callback" || !eventId || !teamId || !isObject(raw.event)) return null;
  return { type: "event", eventId, teamId, event: parseEvent(raw.event) };
}

function parseEvent(event: Json): SlackEvent | null {
  if (event.type === "user_change") {
    const user = parseSlackUser(event.user);
    return user ? { kind: "user", user } : null;
  }
  if (event.type === "reaction_added" || event.type === "reaction_removed") {
    const item = isObject(event.item) ? event.item : {};
    const [channel, ts, user, name] = [text(item.channel), text(item.ts), text(event.user), text(event.reaction)];
    const at = Math.round(Number(text(event.event_ts)) * 1000);
    if (item.type !== "message" || !channel || !ts || !user || !name || !Number.isFinite(at)) return null;
    return { kind: "reaction", channel, ts, user, name, removed: event.type === "reaction_removed", at };
  }
  const channel = text(event.channel);
  if (event.type !== "message" || !channel) return null;
  if (event.subtype === "message_deleted") {
    const ts = text(event.deleted_ts);
    return ts ? { kind: "deleted", channel, ts } : null;
  }
  const type = text(event.channel_type);
  if (type !== "im" && type !== "mpim" && type !== "channel" && type !== "group") return null;
  const message = parseSlackMessage(event.subtype === "message_changed" ? event.message : event);
  return message ? { kind: "message", channel, channelType: type, message } : null;
}

/** The text names this user, as `<@U…>` or `<@U…|name>`. */
export function mentions(raw: string, userId: string): boolean {
  return raw.includes(`<@${userId}>`) || raw.includes(`<@${userId}|`);
}

/**
 * Which conversation a message belongs to, or null to drop it. A reply is its thread's own conversation; a top-level
 * message is its DM's, group DM's or channel's. Every DM and group DM message is kept. In a channel opted in to,
 * everything is kept; elsewhere only a thread Milad started, replied in or is mentioned in, whose root is then the
 * thread's. `threadKnown`: Comma already holds the thread this message starts or replies in.
 */
export function slackRef(
  channel: string, type: SlackChannelType, message: SlackMessage, rules: { self: string; optedIn: boolean; threadKnown: boolean },
): SlackConversationRef | null {
  const reply = message.threadTs !== undefined && message.threadTs !== message.ts;
  if (type === "im" || type === "mpim") return reply ? { type: "thread", channel, threadTs: message.threadTs! } : { type, channel };
  const involved = rules.threadKnown || message.user === rules.self || mentions(message.text, rules.self);
  if (reply) return involved || rules.optedIn ? { type: "thread", channel, threadTs: message.threadTs! } : null;
  if (rules.optedIn) return { type: "channel", channel };
  return involved ? { type: "thread", channel, threadTs: message.ts } : null;
}

/** The Slack user id behind the account's `slack:` self handle. */
export function selfUserId(account: Pick<Doc<"comma_accounts">, "selfHandles">): string {
  const handle = account.selfHandles.find((self) => self.startsWith("slack:"));
  if (!handle) throw new Error("Slack account has no self handle");
  return handle.slice("slack:".length);
}

export async function slackAccount(ctx: Pick<MutationCtx, "db">, teamId: string): Promise<Doc<"comma_accounts"> | null> {
  return await ctx.db.query("comma_accounts")
    .withIndex("by_platform_externalId", (q) => q.eq("platform", "slack").eq("externalId", teamId)).unique();
}

/** Where a message lands, with what Convex already knows about it. Null drops it before any write. */
export async function qualify(ctx: MutationCtx, account: Doc<"comma_accounts">, channel: string, type: SlackChannelType, message: SlackMessage) {
  const scope = { platform: "slack" as const, accountId: account._id };
  const threadKey = slack.conversationKey({ type: "thread", channel, threadTs: message.threadTs ?? message.ts });
  const ref = slackRef(channel, type, message, {
    self: selfUserId(account),
    optedIn: account.slackChannels?.includes(channel) ?? false,
    threadKnown: (await findByKey(ctx, scope, threadKey)) !== null,
  });
  if (!ref) return null;
  return { ref, isNew: (await findByKey(ctx, scope, slack.conversationKey(ref))) === null };
}

/** POST /comma/slack/events. */
export const handleSlackEvents = httpAction(async (ctx, request) => {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return jsonResponse({ ok: false, error: "SLACK_SIGNING_SECRET is not set" }, 500);
  const body = await request.text();
  const signed = await verifySlackSignature(secret, {
    timestamp: request.headers.get("X-Slack-Request-Timestamp"), signature: request.headers.get("X-Slack-Signature"),
  }, body, Math.floor(Date.now() / 1000));
  if (!signed) return jsonResponse({ ok: false, error: "bad signature" }, 401);
  let payload: Payload | null;
  try {
    payload = parseSlackPayload(JSON.parse(body));
  } catch {
    payload = null;
  }
  if (!payload) return jsonResponse({ ok: false, error: "unsupported payload" }, 400);
  if (payload.type === "challenge") return new Response(payload.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  if (payload.teamId === SLACK_TEAM_ID) {
    await ctx.runMutation(internal.comma.slackEvents.receive, { eventId: payload.eventId, teamId: payload.teamId, event: payload.event });
  }
  return new Response(null, { status: 200 });
});

/** A message deleted in Slack, by anyone, or by Milad from Comma. */
export async function retractSlackMessage(ctx: MutationCtx, accountId: Doc<"comma_accounts">["_id"], guid: string): Promise<void> {
  const message = await findMessage(ctx, { platform: "slack", accountId }, guid);
  if (!message || message.retracted) return;
  await ctx.db.patch(message._id, { ...MODEL_TEXT_UNSET, retracted: true, text: "", mentions: [], dateRetracted: Date.now(), sourceVersion: Date.now() });
  await refreshLastMessage(ctx, message.conversationId);
  if (message.threadRef) await countReplies(ctx, accountId, message.conversationId);
}

/** A reaction event on a message Comma keeps. Milad's own, made in Slack or echoed from Comma, is his. */
async function applySlackReaction(ctx: MutationCtx, account: Doc<"comma_accounts">, event: Extract<SlackEvent, { kind: "reaction" }>) {
  const message = await findMessage(ctx, { platform: "slack", accountId: account._id }, slack.messageGuid(event.channel, event.ts));
  if (!message) return;
  const emoji = slackNameEmoji(event.name);
  const isFromMe = event.user === selfUserId(account);
  await applyReaction(ctx, {
    platform: "slack", conversationId: message.conversationId, targetKey: messageKey("slack", account._id, message.guid), key: `emoji:${emoji}`, emoji,
    isFromMe, ...(isFromMe ? {} : { senderAddress: `slack:${event.user}` }), at: event.at, removed: event.removed,
  });
}

const HEARTBEAT_MS = 60_000;

/** The webhook is Slack's heartbeat. It writes at most once a minute, so channel traffic does not re-run status readers. */
async function heartbeat(ctx: MutationCtx, accountId: Doc<"comma_accounts">["_id"]): Promise<void> {
  const key = accountStatusKey("slack", accountId);
  const row = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (row && "connected" in row && row.connected && Date.now() - row.lastSeenAt < HEARTBEAT_MS) return;
  await publishExecutorStatus(ctx, { key, connected: true, lastSeenAt: Date.now(), capabilities: { executor: "slack" } });
}

/** Drops a repeat event_id, then applies the event or schedules its fetch. Only qualified messages schedule work. */
export const receive = internalMutation({
  args: { eventId: v.string(), teamId: v.string(), event: v.union(slackEventValue, v.null()) },
  returns: v.null(),
  handler: async (ctx, { eventId, teamId, event }) => {
    if (await ctx.db.query("comma_slack_events").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).unique()) return null;
    await ctx.db.insert("comma_slack_events", { eventId, receivedAt: Date.now() });
    const account = await slackAccount(ctx, teamId);
    if (!account?.credentials) return null;
    await heartbeat(ctx, account._id);
    if (!event) return null;
    if (event.kind === "user") {
      await upsertSlackUsers(ctx, [event.user]);
      return null;
    }
    if (event.kind === "deleted") {
      await retractSlackMessage(ctx, account._id, slack.messageGuid(event.channel, event.ts));
      return null;
    }
    if (event.kind === "reaction") {
      await applySlackReaction(ctx, account, event);
      return null;
    }
    const kept = await qualify(ctx, account, event.channel, event.channelType, event.message);
    if (!kept) return null;
    await ctx.scheduler.runAfter(0, internal.comma.slackSync.ingestEvent, { accountId: account._id, ...kept, message: event.message });
    return null;
  },
});
