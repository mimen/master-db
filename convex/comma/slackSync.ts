import { v, type Infer } from "convex/values";

import { isPendingGuid } from "../../apps/imsg/shared/pending-send";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { slackMessage, slackRef, slackUser } from "../schema/comma/validators";

import { isGroupKind, slack, type SlackConversationRef } from "./conversationIdentity";
import { findByKey, findMessage } from "./conversationLookup";
import { MODEL_TEXT_UNSET } from "./messageShape";
import { landEcho, refreshLastMessage } from "./pendingSends";
import { schedulePersonSummaries } from "./personSummaries";
import { slackApi, SlackApiError, type SlackParams } from "./slackApi";
import { slackToken } from "./slackAuth";
import { mentions, parseSlackMessage, parseSlackUser, selfUserId, type SlackMessage, type SlackUser } from "./slackEvents";
import { slackNames, unknownSlackUsers, upsertSlackUsers } from "./slackPeople";
import { slackDisplayText, slackModelText } from "./slackText";
import { logReplies } from "./triage";

/**
 * Reading Slack into Comma. Every path (an event, the 90-day backfill, the 15-minute backstop) fetches in an action and
 * writes through `ingestBatch`, which upserts by message id and version, so a page read twice changes nothing.
 */

const conversationBatch = v.object({
  ref: slackRef,
  /** A channel's name, for a channel or a thread in one. */
  name: v.optional(v.string()),
  /** Everyone in a DM or group DM, Milad included or not. Absent elsewhere: a thread's people are its authors. */
  members: v.optional(v.array(v.string())),
  messages: v.array(slackMessage),
});
type ConversationBatch = Infer<typeof conversationBatch>;

const tsMs = (ts: string) => Math.round(Number(ts) * 1000);
const MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
const mentionedIds = (text: string) => [...text.matchAll(MENTION)].map((match) => match[1]!);

type Conversation = Doc<"comma_conversations">;
/** One conversation's share of a batch, and for a thread the DM, group DM or channel Comma holds it in. */
type Home = ConversationBatch & { parent?: Conversation | null };

/** A thread Milad follows: one in a DM or group DM, or one he wrote in or is mentioned in. */
function follows(home: Home, self: string, existing: Conversation | null): boolean {
  if (home.parent && home.parent.kind !== "channel") return true;
  if (existing && existing.slack?.following !== false) return true;
  return home.messages.some((message) => message.user === self || mentions(message.text, self));
}

async function upsertConversation(ctx: MutationCtx, account: Doc<"comma_accounts">, self: string, home: Home) {
  const { ref, parent } = home;
  const scope = { platform: "slack" as const, accountId: account._id };
  const conversationKey = slack.conversationKey(ref);
  const kind = slack.kind(ref);
  const existing = await findByKey(ctx, scope, conversationKey);
  const known = existing?.participants.map((participant) => participant.address.slice("slack:".length)) ?? [];
  // A channel is named by its #name, and every list read resolves each participant, so a busy channel keeps none.
  const ids = ref.type === "channel" ? []
    : [...new Set(home.members ?? [...known, ...home.messages.map((message) => message.user)])].filter((id) => id !== self);
  const participants = ids.map((id) => ({ address: `slack:${id}`, name: null }));
  // A DM is named by its person at read time; a group DM, and a thread in either, lists its members; a channel or a
  // thread in one carries the channel's name.
  const channelName = home.name ? `#${home.name}` : parent?.kind === "channel" ? parent.rawDisplayName : undefined;
  const rawDisplayName = ref.type === "im" ? undefined : ref.type === "mpim" || (parent && parent.kind !== "channel") ? ""
    : channelName ?? existing?.rawDisplayName ?? "Slack thread";
  const fields = {
    platform: "slack" as const, accountId: account._id, conversationKey, kind, isGroup: isGroupKind(kind),
    slack: { channel: ref.channel, ...(ref.type === "thread" ? { threadTs: ref.threadTs, following: follows(home, self, existing) } : {}) },
    displayName: rawDisplayName || "Slack", ...(rawDisplayName !== undefined ? { rawDisplayName } : {}), participants, isSpam: false,
  };
  if (!existing) return await ctx.db.insert("comma_conversations", { ...fields, lastMessageAt: 0, updatedAt: Date.now() });
  const same = existing.displayName === fields.displayName && existing.rawDisplayName === fields.rawDisplayName && existing.kind === kind &&
    JSON.stringify(existing.participants) === JSON.stringify(participants) && existing.slack?.following === fields.slack.following;
  if (!same) await ctx.db.patch(existing._id, { ...fields, updatedAt: Date.now() });
  return existing._id;
}

const isReply = (message: SlackMessage) => message.threadTs !== undefined && message.threadTs !== message.ts;

/**
 * Where each message lives, whichever read brought it: a reply in its thread's conversation, a thread's root in the
 * DM, group DM or channel Comma holds it in (or in the thread when Comma holds none), anything else in its batch's.
 */
async function homesOf(ctx: MutationCtx, accountId: Id<"comma_accounts">, batches: ConversationBatch[]): Promise<Home[]> {
  const scope = { platform: "slack" as const, accountId };
  const parents = new Map<string, Promise<Conversation | null>>();
  const parentOf = (channel: string) => {
    if (!parents.has(channel)) {
      parents.set(channel, Promise.all(slack.parentKeys(channel).map((key) => findByKey(ctx, scope, key)))
        .then((rows) => rows.find((row) => row !== null) ?? null));
    }
    return parents.get(channel)!;
  };
  const homes = new Map<string, Home>();
  const homeFor = async (ref: SlackConversationRef, from: ConversationBatch): Promise<Home> => {
    const key = slack.conversationKey(ref);
    const own = key === slack.conversationKey(from.ref);
    if (!homes.has(key)) {
      homes.set(key, {
        ref, messages: [], ...(own && from.members ? { members: from.members } : {}),
        // A batch's channel name names every conversation of that channel it lands in.
        ...(from.name && (own || ref.type === "thread" || from.ref.type === "thread") ? { name: from.name } : {}),
        ...(ref.type === "thread" ? { parent: await parentOf(ref.channel) } : {}),
      });
    }
    return homes.get(key)!;
  };
  for (const batch of batches) {
    const { ref, messages } = batch;
    // A DM or channel read with no messages still names its members; a thread exists only once it holds one.
    if (ref.type !== "thread") await homeFor(ref, batch);
    for (const message of messages) {
      const root = ref.type === "thread" && message.ts === ref.threadTs ? await parentOf(ref.channel) : null;
      const home: SlackConversationRef = isReply(message) ? { type: "thread", channel: ref.channel, threadTs: message.threadTs! }
        : root?.slack ? slackRefOf(root) : ref;
      (await homeFor(home, batch)).messages.push(message);
    }
  }
  return [...homes.values()];
}

/** Writes users, conversations and messages. Idempotent: a message at or below its stored version is skipped. */
export const ingestBatch = internalMutation({
  args: { accountId: v.id("comma_accounts"), users: v.array(slackUser), conversations: v.array(conversationBatch) },
  returns: v.object({ written: v.number(), skipped: v.number() }),
  handler: async (ctx, { accountId, users, conversations }) => await writeSlackBatch(ctx, accountId, users, conversations),
});

/**
 * ingestBatch's write, which a confirmed send also lands through. Milad's own new message retires the pending send it
 * is the copy of, in the same write, so no frame shows both. A message stored in another conversation than its home
 * moves there, so a read never leaves a reply outside its thread or a root outside its channel.
 */
export async function writeSlackBatch(ctx: MutationCtx, accountId: Id<"comma_accounts">, users: SlackUser[], conversations: ConversationBatch[]) {
  const account = await ctx.db.get(accountId);
  if (account?.platform !== "slack") throw new Error("Not a Slack account");
  await upsertSlackUsers(ctx, users);
  const self = selfUserId(account);
  const scope = { platform: "slack" as const, accountId };
  const names = await slackNames(ctx, conversations.flatMap((batch) => batch.messages.flatMap((message) => mentionedIds(message.text))));
  const toModelText = slackModelText((id) => names.get(id));
  let written = 0;
  let skipped = 0;
  const touched = new Set<Id<"comma_conversations">>();
  const real: Pick<Doc<"comma_messages">, "conversationId" | "guid" | "dateCreated" | "isFromMe" | "sender">[] = [];
  for (const home of await homesOf(ctx, accountId, conversations)) {
    const conversationId = await upsertConversation(ctx, account, self, home);
    for (const message of home.messages) {
      const display = slackDisplayText(message.text, (id) => names.get(id));
      const row = {
        platform: "slack" as const, accountId, conversationId, guid: slack.messageGuid(home.ref.channel, message.ts),
        dateCreated: tsMs(message.ts), isFromMe: message.user === self, sender: { address: `slack:${message.user}`, name: null },
        text: display.text, mentions: display.mentions, mentionsMe: mentions(message.text, self),
        ...toModelText({ text: message.text, ts: message.ts, ...(message.threadTs ? { thread_ts: message.threadTs } : {}) }),
        edited: message.editedTs !== undefined, ...(message.editedTs ? { dateEdited: tsMs(message.editedTs) } : {}),
        retracted: false, isGroupEvent: false, attachmentGuids: [], sourceVersion: message.editedTs ? tsMs(message.editedTs) : 0,
        ...(message.clientKey ? { clientKey: message.clientKey } : {}),
      };
      const existing = await findMessage(ctx, scope, row.guid);
      const moved = existing !== null && existing.conversationId !== conversationId;
      if (existing && (existing.retracted || (!moved && existing.sourceVersion >= row.sourceVersion))) {
        skipped++;
        continue;
      }
      if (existing) {
        await ctx.db.patch(existing._id, { ...MODEL_TEXT_UNSET, ...row });
        touched.add(existing.conversationId);
      } else {
        await ctx.db.insert("comma_messages", row);
        if (row.isFromMe) await landEcho(ctx, row);
      }
      written++;
      touched.add(conversationId);
      real.push(row);
    }
  }
  for (const conversationId of touched) {
    await refreshLastMessage(ctx, conversationId);
    await countReplies(ctx, accountId, conversationId);
  }
  await logReplies(ctx, real);
  await schedulePersonSummaries(ctx, real);
  return { written, skipped };
}

/** Stamps the thread's reply count on its root, wherever the root lives. Nothing happens for a conversation that isn't a thread. */
export async function countReplies(ctx: MutationCtx, accountId: Id<"comma_accounts">, conversationId: Id<"comma_conversations">): Promise<void> {
  const thread = (await ctx.db.get(conversationId))?.slack;
  if (!thread?.threadTs) return;
  const rootGuid = slack.messageGuid(thread.channel, thread.threadTs);
  let replyCount = 0;
  for await (const message of ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId))) {
    if (!message.retracted && message.guid !== rootGuid && !isPendingGuid(message.guid)) replyCount++;
  }
  const root = await findMessage(ctx, { platform: "slack", accountId }, rootGuid);
  if (root && root.replyCount !== replyCount) await ctx.db.patch(root._id, { replyCount });
}

/** The Slack conversation a Comma conversation reads from. */
export function slackRefOf(conversation: Pick<Doc<"comma_conversations">, "kind" | "slack">): SlackConversationRef {
  if (!conversation.slack) throw new Error("Not a Slack conversation");
  const { channel, threadTs } = conversation.slack;
  if (threadTs) return { type: "thread", channel, threadTs };
  return { type: conversation.kind === "dm" ? "im" : conversation.kind === "channel" ? "channel" : "mpim", channel };
}

export const unknownUsers = internalQuery({
  args: { userIds: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { userIds }) => await unknownSlackUsers(ctx, userIds),
});

type Cursored = { response_metadata?: { next_cursor?: string } };
const nextCursor = (page: Cursored) => page.response_metadata?.next_cursor || undefined;
const parsed = (raw: unknown[] | undefined) => (raw ?? []).map(parseSlackMessage).filter((message): message is SlackMessage => message !== null);

/** A DM's other person, a group DM's members, or a channel's name. */
async function channelInfo(token: string, channel: string): Promise<{ name?: string; members?: string[] }> {
  const { channel: info } = await slackApi<{ channel: { is_im?: boolean; is_mpim?: boolean; user?: string; name?: string } }>(
    "conversations.info", { channel }, token);
  if (info.is_im) return { members: info.user ? [info.user] : [] };
  if (info.is_mpim) return { members: (await slackApi<{ members: string[] }>("conversations.members", { channel, limit: 200 }, token)).members };
  return info.name ? { name: info.name } : {};
}

async function page(method: "conversations.history" | "conversations.replies", params: SlackParams, token: string) {
  const result = await slackApi<{ messages?: unknown[] } & Cursored>(method, { limit: 200, ...params }, token);
  return { messages: parsed(result.messages), raw: result.messages ?? [], cursor: nextCursor(result) };
}

/** Looks up the people a batch names that the graph lacks, then writes it. */
async function ingest(ctx: ActionCtx, token: string, accountId: Id<"comma_accounts">, conversations: ConversationBatch[]) {
  const ids = conversations.flatMap((batch) => [...(batch.members ?? []), ...batch.messages.flatMap((message) => [message.user, ...mentionedIds(message.text)])]);
  const unknown = await ctx.runQuery(internal.comma.slackSync.unknownUsers, { userIds: ids });
  const users = (await Promise.all(unknown.map((user) => slackApi<{ user: unknown }>("users.info", { user }, token)
    .then((result) => parseSlackUser(result.user), () => null)))).filter((user) => user !== null);
  return await ctx.runMutation(internal.comma.slackSync.ingestBatch, { accountId, users, conversations });
}

/** One qualified event. A conversation Comma has not seen gets its name and members, and a new thread arrives whole. */
export const ingestEvent = internalAction({
  args: { accountId: v.id("comma_accounts"), ref: slackRef, isNew: v.boolean(), message: slackMessage },
  returns: v.null(),
  handler: async (ctx, { accountId, ref, isNew, message }) => {
    const token = await slackToken(ctx, accountId);
    if (!token) return null;
    const info = isNew ? await channelInfo(token, ref.channel) : {};
    const messages = isNew && ref.type === "thread" ? await threadMessages(token, ref.channel, ref.threadTs) : [message];
    await ingest(ctx, token, accountId, [{ ref, ...info, messages }]);
    return null;
  },
});

async function threadMessages(token: string, channel: string, ts: string): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const result = await page("conversations.replies", { channel, ts, cursor }, token);
    messages.push(...result.messages);
    cursor = result.cursor;
  } while (cursor);
  return messages;
}

// ---- Backfill: 90 days, one Slack page per step, its state in comma_sync_state. ----

const BACKFILL_KEY = "slack:backfill";
const BACKSTOP_KEY = "slack:backstop";
const BACKFILL_DAYS = 90;
/** Slack's history and replies reads allow about 50 a minute; users.list and search allow 20. */
const STEP_MS = 1_500;
const TIER2_STEP_MS = 3_500;

type Channel = { id: string; type: "im" | "mpim" | "channel"; name?: string; members?: string[] };
/** A thread to read whole, and the conversation its read lands through: its DM, group DM or channel, or the thread itself. */
type Thread = { channel: string; ts: string; into: "im" | "mpim" | "channel" | "thread" };
export type BackfillState = {
  run: string;
  step: "users" | "conversations" | "history" | "search" | "replies" | "done";
  cursor?: string;
  /** Slack seconds; nothing older is read. */
  oldest: string;
  optedIn: string[];
  channels: Channel[];
  threads: Thread[];
  query?: number;
  page?: number;
  /** One channel opted in to: its history and its threads, with no search. */
  channelOnly?: boolean;
  /** Re-reads users.list alone, so every Slack identity's name and picture are current. */
  usersOnly?: boolean;
};

async function syncRow(ctx: Pick<QueryCtx, "db">, accountId: Id<"comma_accounts">, key: string) {
  return await ctx.db.query("comma_sync_state").withIndex("by_account_key", (q) => q.eq("accountId", accountId).eq("key", key)).unique();
}

async function writeSync(ctx: MutationCtx, accountId: Id<"comma_accounts">, key: string, fields: { cursor?: string; lastReconcileAt?: number }) {
  const row = await syncRow(ctx, accountId, key);
  if (row) await ctx.db.patch(row._id, { ...fields, updatedAt: Date.now() });
  else await ctx.db.insert("comma_sync_state", { accountId, key, ...fields, updatedAt: Date.now() });
}

async function startRun(ctx: MutationCtx, accountId: Id<"comma_accounts">, key: string, fields: Pick<BackfillState, "step" | "optedIn" | "channels" | "channelOnly" | "usersOnly">) {
  const now = Date.now();
  const state: BackfillState = { run: String(now), oldest: String(Math.floor((now - BACKFILL_DAYS * 86_400_000) / 1000)), threads: [], ...fields };
  await writeSync(ctx, accountId, key, { cursor: JSON.stringify(state) });
  await ctx.scheduler.runAfter(0, internal.comma.slackSync.backfill, { accountId, run: state.run, key });
}

/** Starts a fresh backfill; a run still going from before stops at its next step. Connecting Slack calls this. */
export const startBackfill = internalMutation({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return null;
    await startRun(ctx, accountId, BACKFILL_KEY, { step: "users", optedIn: account.slackChannels ?? [], channels: [] });
    return null;
  },
});

/** Re-reads every connected workspace's users.list under `slack:backfill:users`, one paced page per step. Run by hand. */
export const refreshUsers = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const accounts = (await ctx.db.query("comma_accounts").withIndex("by_platform_externalId", (q) => q.eq("platform", "slack")).collect())
      .filter((account) => account.credentials);
    for (const account of accounts) await startRun(ctx, account._id, `${BACKFILL_KEY}:users`, { step: "users", optedIn: [], channels: [], usersOnly: true });
    return accounts.length;
  },
});

/** Reads 90 days of one channel just opted in to, and its threads, under its own sync row (`slack:backfill:<channel>`). */
export async function startChannelBackfill(ctx: MutationCtx, accountId: Id<"comma_accounts">, channel: { id: string; name: string }) {
  await startRun(ctx, accountId, `${BACKFILL_KEY}:${channel.id}`, {
    step: "history", optedIn: [channel.id], channels: [{ id: channel.id, type: "channel", name: channel.name }], channelOnly: true,
  });
}

export const backfillState = internalQuery({
  args: { accountId: v.id("comma_accounts"), key: v.optional(v.string()) },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { accountId, key }) => (await syncRow(ctx, accountId, key ?? BACKFILL_KEY))?.cursor ?? null,
});

export const saveBackfill = internalMutation({
  args: { accountId: v.id("comma_accounts"), run: v.string(), state: v.string(), key: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { accountId, run, state, key = BACKFILL_KEY }) => {
    const current = (await syncRow(ctx, accountId, key))?.cursor;
    if (!current || (JSON.parse(current) as BackfillState).run !== run) return false;
    await writeSync(ctx, accountId, key, { cursor: state });
    return true;
  },
});

/** Runs one step, saves where it got to, and schedules the next. A rate limit waits as long as Slack asks. */
export const backfill = internalAction({
  args: { accountId: v.id("comma_accounts"), run: v.string(), key: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { accountId, run, key }) => {
    const stored = await ctx.runQuery(internal.comma.slackSync.backfillState, { accountId, key });
    const state = stored ? (JSON.parse(stored) as BackfillState) : null;
    if (!state || state.run !== run || state.step === "done") return null;
    const token = await slackToken(ctx, accountId);
    if (!token) return null;
    let next = state;
    let delay = state.step === "search" || state.step === "users" ? TIER2_STEP_MS : STEP_MS;
    try {
      next = await backfillStep(ctx, token, accountId, state);
    } catch (error) {
      if (!(error instanceof SlackApiError && error.code === "ratelimited")) throw error;
      delay = (error.retryAfterSeconds ?? 30) * 1000;
    }
    if (!(await ctx.runMutation(internal.comma.slackSync.saveBackfill, { accountId, run, state: JSON.stringify(next), key }))) return null;
    if (next.step !== "done") await ctx.scheduler.runAfter(delay, internal.comma.slackSync.backfill, { accountId, run, key });
    return null;
  },
});

/** Slack refused one channel or thread (archived, left, gone): the step moves past it rather than stopping the run. */
async function orSkip<T>(read: () => Promise<T>, skipped: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SlackApiError && error.code !== "ratelimited") return skipped;
    throw error;
  }
}

const day = (seconds: string) => new Date(Number(seconds) * 1000).toISOString().slice(0, 10);

export async function backfillStep(ctx: ActionCtx, token: string, accountId: Id<"comma_accounts">, state: BackfillState): Promise<BackfillState> {
  switch (state.step) {
    case "users": {
      const result = await slackApi<{ members?: { is_bot?: boolean; deleted?: boolean }[] } & Cursored>("users.list", { limit: 200, cursor: state.cursor }, token);
      const users = (result.members ?? []).filter((member) => !member.is_bot).map(parseSlackUser).filter((user) => user !== null);
      await ctx.runMutation(internal.comma.slackSync.ingestBatch, { accountId, users, conversations: [] });
      const cursor = nextCursor(result);
      if (cursor) return { ...state, cursor };
      return { ...state, step: state.usersOnly ? "done" : "conversations", cursor: undefined };
    }
    case "conversations": {
      const result = await slackApi<{ channels?: { id: string; is_im?: boolean; is_mpim?: boolean; user?: string; name?: string }[] } & Cursored>(
        "users.conversations", { types: "im,mpim,public_channel,private_channel", exclude_archived: true, limit: 200, cursor: state.cursor }, token);
      const channels = (result.channels ?? []).flatMap((channel): Channel[] => {
        if (channel.is_im) return [{ id: channel.id, type: "im", members: channel.user ? [channel.user] : [] }];
        if (channel.is_mpim) return [{ id: channel.id, type: "mpim" }];
        return state.optedIn.includes(channel.id) ? [{ id: channel.id, type: "channel", ...(channel.name ? { name: channel.name } : {}) }] : [];
      });
      const cursor = nextCursor(result);
      return { ...state, channels: [...state.channels, ...channels], ...(cursor ? { cursor } : { step: "history", cursor: undefined }) };
    }
    case "history": {
      const [channel, ...rest] = state.channels;
      if (!channel) return state.channelOnly ? { ...state, step: "replies", cursor: undefined } : { ...state, step: "search", cursor: undefined, query: 0, page: 1 };
      const members = channel.type === "mpim" && !channel.members
        ? await orSkip(async () => (await channelInfo(token, channel.id)).members ?? [], []) : channel.members;
      const result = await orSkip(() => page("conversations.history", { channel: channel.id, oldest: state.oldest, cursor: state.cursor }, token),
        { messages: [], raw: [], cursor: undefined });
      const ref: SlackConversationRef = { type: channel.type, channel: channel.id };
      await ingest(ctx, token, accountId, [{ ref, ...(channel.name ? { name: channel.name } : {}), ...(members ? { members } : {}), messages: result.messages }]);
      // Every thread in a DM, group DM or opted-in channel is read whole; elsewhere search finds the ones Milad is in.
      const threads = result.raw.flatMap((raw): Thread[] => {
        const root = raw as { ts?: string; reply_count?: number };
        return root.ts && root.reply_count ? [{ channel: channel.id, ts: root.ts, into: channel.type }] : [];
      });
      const updated = { ...channel, ...(members ? { members } : {}) };
      return result.cursor
        ? { ...state, cursor: result.cursor, channels: [updated, ...rest], threads: [...state.threads, ...threads] }
        : { ...state, cursor: undefined, channels: rest, threads: [...state.threads, ...threads] };
    }
    case "search": {
      const account = await ctx.runQuery(internal.comma.slackSync.accountSelf, { accountId });
      const queries = [`from:<@${account}> after:${day(state.oldest)}`, `<@${account}> after:${day(state.oldest)}`];
      const query = state.query ?? 0;
      const pageNumber = state.page ?? 1;
      const result = await slackApi<{ messages?: { matches?: { ts: string; permalink?: string; channel?: { id: string; is_im?: boolean; is_mpim?: boolean } }[]; paging?: { pages?: number } } }>(
        "search.messages", { query: queries[query], count: 100, page: pageNumber, sort: "timestamp" }, token);
      const seen = new Set(state.threads.map((thread) => `${thread.channel}:${thread.ts}`));
      const threads = (result.messages?.matches ?? []).flatMap((match): Thread[] => {
        if (!match.channel || match.channel.is_im || match.channel.is_mpim) return [];
        const root = match.permalink ? new URL(match.permalink).searchParams.get("thread_ts") ?? match.ts : match.ts;
        const key = `${match.channel.id}:${root}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ channel: match.channel.id, ts: root, into: "thread" }];
      });
      const more = pageNumber < (result.messages?.paging?.pages ?? 1);
      const advance = more ? { page: pageNumber + 1 } : query + 1 < queries.length ? { query: query + 1, page: 1 } : { step: "replies" as const };
      return { ...state, threads: [...state.threads, ...threads], ...advance };
    }
    case "replies": {
      const [thread, ...rest] = state.threads;
      if (!thread) return { ...state, step: "done", cursor: undefined };
      const ref: SlackConversationRef = thread.into === "thread" ? { type: "thread", channel: thread.channel, threadTs: thread.ts } : { type: thread.into, channel: thread.channel };
      const info = thread.into === "thread" && !state.cursor ? await orSkip(() => channelInfo(token, thread.channel), {}) : {};
      const result = await orSkip(() => page("conversations.replies", { channel: thread.channel, ts: thread.ts, cursor: state.cursor }, token),
        { messages: [], raw: [], cursor: undefined });
      await ingest(ctx, token, accountId, [{ ref, ...info, messages: result.messages }]);
      return result.cursor ? { ...state, cursor: result.cursor } : { ...state, cursor: undefined, threads: rest };
    }
    case "done":
      return state;
  }
}

export const accountSelf = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.string(),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (!account) throw new Error("Account not found");
    return selfUserId(account);
  },
});

// ---- Backstop: every 15 minutes, re-read recent history of active conversations. ----

const BACKSTOP_ACTIVE_MS = 7 * 86_400_000;
const BACKSTOP_LIMIT = 30;
/** Read a little before the last run, so a message that landed during it is not missed. */
const BACKSTOP_OVERLAP_MS = 5 * 60_000;
/** Slack retries an event for minutes, not hours. */
const EVENT_ID_TTL_MS = 60 * 60_000;

export const backstopTargets = internalQuery({
  args: {},
  returns: v.array(v.object({ accountId: v.id("comma_accounts"), since: v.number(), refs: v.array(slackRef) })),
  handler: async (ctx) => {
    const now = Date.now();
    const accounts = (await ctx.db.query("comma_accounts").withIndex("by_platform_externalId", (q) => q.eq("platform", "slack")).collect())
      .filter((account) => account.credentials !== undefined);
    // ponytail: scans every platform's recently active conversations; add a platform index if Slack's share gets small.
    const recent = await ctx.db.query("comma_conversations").withIndex("by_lastMessageAt", (q) => q.gt("lastMessageAt", now - BACKSTOP_ACTIVE_MS))
      .order("desc").take(1000);
    return await Promise.all(accounts.map(async (account) => {
      const last = (await syncRow(ctx, account._id, BACKSTOP_KEY))?.lastReconcileAt ?? now - 60 * 60_000;
      const refs = recent.filter((conversation) => conversation.platform === "slack" && conversation.accountId === account._id && conversation.slack)
        .slice(0, BACKSTOP_LIMIT).map(slackRefOf);
      return { accountId: account._id, since: last - BACKSTOP_OVERLAP_MS, refs };
    }));
  },
});

export const finishBackstop = internalMutation({
  args: { accountId: v.id("comma_accounts"), at: v.number() },
  returns: v.null(),
  handler: async (ctx, { accountId, at }) => {
    await writeSync(ctx, accountId, BACKSTOP_KEY, { lastReconcileAt: at });
    return null;
  },
});

export const pruneEvents = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await ctx.db.query("comma_slack_events").withIndex("by_receivedAt", (q) => q.lt("receivedAt", Date.now() - EVENT_ID_TTL_MS)).take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return null;
  },
});

/** The cron: anything the webhook missed in an active conversation lands within 15 minutes. */
export const backstop = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(internal.comma.slackSync.pruneEvents, {});
    for (const { accountId, since, refs } of await ctx.runQuery(internal.comma.slackSync.backstopTargets, {})) {
      const token = await slackToken(ctx, accountId);
      if (!token) continue;
      const startedAt = Date.now();
      const oldest = (since / 1000).toFixed(6);
      for (const ref of refs) {
        const result = await orSkip(() => ref.type === "thread"
          ? page("conversations.replies", { channel: ref.channel, ts: ref.threadTs, oldest }, token)
          : page("conversations.history", { channel: ref.channel, oldest }, token), { messages: [], raw: [], cursor: undefined });
        if (result.messages.length) await ingest(ctx, token, accountId, [{ ref, messages: result.messages }]);
      }
      await ctx.runMutation(internal.comma.slackSync.finishBackstop, { accountId, at: startedAt });
    }
    return null;
  },
});
