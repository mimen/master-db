import { v, type Infer } from "convex/values";

import { accountStatusKey } from "../../apps/imsg/shared/executors";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import { recomputePersonAggregates } from "../identity/internal";
import { gmailMessageValue } from "../schema/comma/validators";

import { isSelf } from "./accounts";
import { publishExecutorStatus } from "./bridgeState";
import { gmail } from "./conversationIdentity";
import { findByKey, findMessage } from "./conversationLookup";
import { GMAIL_API, googleApi, GoogleApiError } from "./gmailApi";
import { writeGmailFiles } from "./gmailFiles";
import { METADATA_HEADERS, parseGmailMessage, type EmailAddress, type RawGmailMessage } from "./gmailMessage";
import { gmailToken, pushTopic } from "./googleAuth";
import { refreshLastMessage } from "./pendingSends";
import { schedulePersonSummaries } from "./personSummaries";
import { personForNormalized } from "./photos";
import { resurfaceOnMessages } from "./later";
import { logReplies, settleConversation, unsettleConversation } from "./triage";

/**
 * Reading a Gmail mailbox into Comma. Every path (a push nudge, the 5-minute backstop, the paged backfill, a full
 * resync) reads whole threads in an action and writes each through `ingestThread`, which skips messages it holds, so a
 * thread read twice changes nothing. A thread's Inbox label is its settle state: archived in Gmail is settled in Comma.
 */

type GmailMessageValue = Infer<typeof gmailMessageValue>;

/** A thread lists at most this many people; a mailing list's hundred recipients would slow every list read. */
const MAX_PARTICIPANTS = 20;

async function syncRow(ctx: Pick<QueryCtx, "db">, accountId: Id<"comma_accounts">, key: string) {
  return await ctx.db.query("comma_sync_state").withIndex("by_account_key", (q) => q.eq("accountId", accountId).eq("key", key)).unique();
}

async function writeSync(ctx: MutationCtx, accountId: Id<"comma_accounts">, key: string, fields: { cursor?: string; lastReconcileAt?: number; lastEventAt?: number }) {
  const row = await syncRow(ctx, accountId, key);
  if (row) await ctx.db.patch(row._id, { ...fields, updatedAt: Date.now() });
  else await ctx.db.insert("comma_sync_state", { accountId, key, ...fields, updatedAt: Date.now() });
}

export async function gmailAccount(ctx: Pick<QueryCtx, "db">, accountId: Id<"comma_accounts">): Promise<Doc<"comma_accounts">> {
  const account = await ctx.db.get(accountId);
  if (account?.platform !== "gmail") throw new Error("Not a Gmail account");
  return account;
}

/** A sender as an email identity, joined to the person who already has that exact address under any handle kind. */
async function upsertEmailSender(ctx: MutationCtx, sender: EmailAddress): Promise<void> {
  const known = await ctx.db.query("identities")
    .withIndex("by_kind_normalized", (q) => q.eq("kind", "email").eq("normalized", sender.address)).first();
  const now = new Date().toISOString();
  if (known) {
    if (!known.display_name && sender.name) await ctx.db.patch(known._id, { display_name: sender.name, updated_at: now });
    return;
  }
  const person = await personForNormalized(ctx, sender.address);
  await ctx.db.insert("identities", {
    ...(person ? { person_id: person._id } : {}), kind: "email", value: sender.address, normalized: sender.address, network: "gmail",
    ...(sender.name ? { display_name: sender.name } : {}), message_count: 0, chat_count: 0, is_self: false, source: "gmail",
    first_seen_at: now, last_seen_at: now, created_at: now, updated_at: now,
  });
  if (person) await recomputePersonAggregates(ctx, person._id);
}

const participantsOf = (account: Doc<"comma_accounts">, messages: readonly GmailMessageValue[]) => [...new Map(messages
  .flatMap((message) => [message.from, ...message.to, ...message.cc])
  .filter((address) => !isSelf(account, address.address))
  .map((address) => [address.address, { address: address.address, name: null }])).values()].slice(0, MAX_PARTICIPANTS);

/**
 * Writes one thread: the conversation, new messages, senders as identities, and the settle its Inbox label implies.
 * Gmail never changes a message once sent, so a message already stored is skipped. `quiet`: a backfill or resync,
 * whose settles leave no clear in the log. `historyId`: the read's, so one older than the thread's last write is dropped.
 */
export async function writeGmailThread(ctx: MutationCtx, accountId: Id<"comma_accounts">, threadId: string, raw: readonly GmailMessageValue[], quiet: boolean,
  historyId?: string) {
  const account = await gmailAccount(ctx, accountId);
  const messages = raw.filter((message) => !message.labelIds.includes("DRAFT")).sort((a, b) => a.internalDate - b.internalDate);
  if (!messages.length) return { written: 0, skipped: 0 };
  const scope = { platform: "gmail" as const, accountId };
  const inInbox = messages.some((message) => message.labelIds.includes("INBOX"));
  // A reply is never bulk, so replying to a thread lifts it out.
  const bulk = messages.every((message) => message.bulk);
  const unread = messages.filter((message) => message.labelIds.includes("UNREAD")).length;
  const conversationKey = gmail.conversationKey(threadId);
  const existing = await findByKey(ctx, scope, conversationKey);
  const held = existing?.gmail?.historyId;
  // Two syncs can read one thread and commit out of order; the older read's labels are stale, and its messages are held.
  if (held && historyId && BigInt(historyId) < BigInt(held)) return { written: 0, skipped: messages.length };
  const newest = historyId ?? held;
  // A refused archive stays on screen while the thread is still in the inbox; a settle or an archive in Gmail ends it.
  const archiveError = inInbox ? existing?.gmail?.archiveError : undefined;
  const fields = {
    platform: "gmail" as const, accountId, conversationKey, kind: gmail.kind(), isGroup: true, unlisted: true as const,
    gmail: { threadId, subject: messages[0]!.subject || "(no subject)", inInbox, bulk, ...(unread ? { unread } : {}), ...(archiveError ? { archiveError } : {}),
      ...(newest ? { historyId: newest } : {}) },
    // An email thread is named by its people at read time; the Mail list shows the subject beside them.
    displayName: messages[0]!.subject || "(no subject)", rawDisplayName: "",
    participants: participantsOf(account, messages), isSpam: messages.some((message) => message.labelIds.includes("SPAM")),
  };
  let conversationId: Id<"comma_conversations">;
  if (!existing) conversationId = await ctx.db.insert("comma_conversations", { ...fields, lastMessageAt: 0, updatedAt: Date.now() });
  else {
    conversationId = existing._id;
    const same = JSON.stringify([existing.gmail, existing.displayName, existing.participants, existing.isSpam, existing.unlisted]) ===
      JSON.stringify([fields.gmail, fields.displayName, fields.participants, fields.isSpam, fields.unlisted]);
    if (!same) await ctx.db.patch(existing._id, { ...fields, updatedAt: Date.now() });
  }
  const written = await insertGmailMessages(ctx, account, conversationId, messages);
  // Archived in Gmail is settled in Comma. Only a live archive the user made in Gmail counts as cleared today. A thread
  // whose inbox state Comma already holds is left alone, so the echo of Comma's own archive or unarchive does nothing.
  const prior = existing?.gmail?.inInbox;
  if ((await ctx.db.get(conversationId))?.lastMessage) {
    if (!inInbox && (prior !== false || written > 0)) await settleConversation(ctx, conversationId, undefined, { by: "mailbox", quiet: quiet || prior !== true });
    else if (inInbox && prior === false && written === 0) await unsettleConversation(ctx, conversationId, { by: "mailbox", quiet });
  }
  return { written, skipped: messages.length - written };
}

/** Writes the messages the thread does not hold yet, each sender as an identity, and the replies they answer. Returns how many it wrote. */
export async function insertGmailMessages(ctx: MutationCtx, account: Doc<"comma_accounts">, conversationId: Id<"comma_conversations">,
  messages: readonly GmailMessageValue[], clientKey?: string): Promise<number> {
  const scope = { platform: "gmail" as const, accountId: account._id };
  const real: Pick<Doc<"comma_messages">, "conversationId" | "guid" | "dateCreated" | "isFromMe" | "sender" | "mentionsMe">[] = [];
  for (const message of messages) {
    const stored = await findMessage(ctx, scope, message.id);
    if (stored) {
      // A message stored before Comma kept Gmail's attachments gets them from any later full read, which the files backfill relies on.
      if (message.attachments?.length && !stored.attachmentGuids.length) {
        await ctx.db.patch(stored._id, { attachmentGuids: await writeGmailFiles(ctx, account._id, stored.conversationId, message) });
      }
      continue;
    }
    const attachmentGuids = await writeGmailFiles(ctx, account._id, conversationId, message);
    const row = {
      platform: "gmail" as const, accountId: account._id, conversationId, guid: message.id, dateCreated: message.internalDate,
      isFromMe: message.labelIds.includes("SENT") || isSelf(account, message.from.address),
      sender: message.from, text: message.text, ...message.model, mentions: [], mentionsMe: false, edited: false, retracted: false,
      isGroupEvent: false, attachmentGuids, sourceVersion: 0, ...(clientKey ? { clientKey } : {}),
      gmail: {
        from: message.from, to: message.to, cc: message.cc, bulk: message.bulk,
        ...(message.html !== undefined ? { html: message.html, blockedImages: message.blockedImages ?? 0 } : {}),
      },
    };
    await ctx.db.insert("comma_messages", row);
    if (!row.isFromMe && !message.bulk) await upsertEmailSender(ctx, message.from);
    real.push(row);
  }
  if (real.length) await refreshLastMessage(ctx, conversationId);
  await logReplies(ctx, real);
  await resurfaceOnMessages(ctx, real);
  await schedulePersonSummaries(ctx, real);
  return real.length;
}

export const ingestThread = internalMutation({
  args: { accountId: v.id("comma_accounts"), threadId: v.string(), messages: v.array(gmailMessageValue), quiet: v.boolean(), historyId: v.optional(v.string()) },
  returns: v.object({ written: v.number(), skipped: v.number() }),
  handler: async (ctx, { accountId, threadId, messages, quiet, historyId }) => await writeGmailThread(ctx, accountId, threadId, messages, quiet, historyId),
});

/**
 * Whether a thread Comma does not hold yet is worth keeping: anything in the inbox, and elsewhere only a thread where
 * the user wrote or a participant resolves to a person.
 */
export const worthKeeping = internalQuery({
  args: { accountId: v.id("comma_accounts"), threadId: v.string(), inInbox: v.boolean(), fromMe: v.boolean(), addresses: v.array(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { accountId, threadId, inInbox, fromMe, addresses }) => {
    if (inInbox || fromMe) return true;
    if (await findByKey(ctx, { platform: "gmail", accountId }, gmail.conversationKey(threadId))) return true;
    for (const address of addresses) if (await personForNormalized(ctx, address)) return true;
    return false;
  },
});

export const selfHandles = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.array(v.string()),
  handler: async (ctx, { accountId }) => (await gmailAccount(ctx, accountId)).selfHandles,
});

type RawThread = { id: string; historyId?: string; messages?: RawGmailMessage[] };

const threadUrl = (threadId: string, format: "metadata" | "full") => {
  const params = new URLSearchParams({ format });
  if (format === "metadata") for (const header of METADATA_HEADERS) params.append("metadataHeaders", header);
  return `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?${params}`;
};

/**
 * Reads a thread and writes it. Headers come first; bodies are read only when some message is not bulk mail, so a
 * newsletter costs one small read. Null when Gmail no longer has the thread or it is not worth keeping.
 */
async function readThread(ctx: ActionCtx, token: string, accountId: Id<"comma_accounts">, threadId: string, quiet: boolean, self: readonly string[]) {
  let thread: RawThread;
  try {
    thread = await googleApi<RawThread>(threadUrl(threadId, "metadata"), { token });
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 404) return null;
    throw error;
  }
  let messages = (thread.messages ?? []).map(parseGmailMessage);
  const fromMe = messages.some((message) => message.labelIds.includes("SENT") || self.includes(message.from.address));
  const keep = await ctx.runQuery(internal.comma.gmailSync.worthKeeping, {
    accountId, threadId, fromMe, inInbox: messages.some((message) => message.labelIds.includes("INBOX")),
    addresses: [...new Set(messages.flatMap((message) => [message.from, ...message.to, ...message.cc].map((address) => address.address)))],
  });
  if (!keep) return null;
  if (fromMe || messages.some((message) => !message.bulk)) {
    thread = await googleApi<RawThread>(threadUrl(threadId, "full"), { token });
    messages = (thread.messages ?? []).map(parseGmailMessage);
  }
  return await ctx.runMutation(internal.comma.gmailSync.ingestThread, { accountId, threadId, messages, quiet, historyId: thread.historyId });
}

// ---- History sync: what changed since the stored historyId. A push and the backstop both run it. ----

const HISTORY_KEY = "gmail:history";
const BACKFILL_KEY = "gmail:backfill";
const WATCH_KEY = "gmail:watch";
const HEARTBEAT_MS = 60_000;

export const historyCursor = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { accountId }) => (await syncRow(ctx, accountId, HISTORY_KEY))?.cursor ?? null,
});

/** Moves the cursor forward only: two syncs racing never move it back. A sync is the mailbox's heartbeat. */
export const saveHistory = internalMutation({
  args: { accountId: v.id("comma_accounts"), historyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, historyId }) => {
    const current = (await syncRow(ctx, accountId, HISTORY_KEY))?.cursor;
    if (!current || BigInt(historyId) > BigInt(current)) await writeSync(ctx, accountId, HISTORY_KEY, { cursor: historyId, lastEventAt: Date.now() });
    const key = accountStatusKey("gmail", accountId);
    const status = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (status && "connected" in status && status.connected && Date.now() - status.lastSeenAt < HEARTBEAT_MS) return null;
    await publishExecutorStatus(ctx, { key, connected: true, lastSeenAt: Date.now(), capabilities: { executor: "gmail" } });
    return null;
  },
});

type HistoryPage = {
  history?: { messages?: { threadId: string }[]; messagesAdded?: { message: { threadId: string } }[];
    labelsAdded?: { message: { threadId: string } }[]; labelsRemoved?: { message: { threadId: string } }[] }[];
  nextPageToken?: string;
  historyId?: string;
};

/** Every thread history.list names since the cursor, then each thread re-read whole. A cursor Gmail forgot (404) resyncs the inbox. */
export async function syncMailbox(ctx: ActionCtx, accountId: Id<"comma_accounts">): Promise<void> {
  const token = await gmailToken(ctx, accountId);
  const cursor = await ctx.runQuery(internal.comma.gmailSync.historyCursor, { accountId });
  if (!token || !cursor) return;
  const threads = new Set<string>();
  let latest = cursor;
  let pageToken: string | undefined;
  try {
    do {
      const params = new URLSearchParams({ startHistoryId: cursor, maxResults: "500", ...(pageToken ? { pageToken } : {}) });
      for (const type of ["messageAdded", "labelAdded", "labelRemoved"]) params.append("historyTypes", type);
      const page = await googleApi<HistoryPage>(`${GMAIL_API}/history?${params}`, { token });
      for (const entry of page.history ?? []) {
        for (const item of [...(entry.messages ?? []), ...(entry.messagesAdded ?? []).map((added) => added.message),
          ...(entry.labelsAdded ?? []).map((added) => added.message), ...(entry.labelsRemoved ?? []).map((removed) => removed.message)]) {
          threads.add(item.threadId);
        }
      }
      latest = page.historyId ?? latest;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (error) {
    if (!(error instanceof GoogleApiError && error.status === 404)) throw error;
    await ctx.runAction(internal.comma.gmailSync.startBackfill, { accountId, resync: true });
    return;
  }
  const self = await ctx.runQuery(internal.comma.gmailSync.selfHandles, { accountId });
  for (const threadId of threads) await readThread(ctx, token, accountId, threadId, false, self);
  await ctx.runMutation(internal.comma.gmailSync.saveHistory, { accountId, historyId: latest });
}

export const sync = internalAction({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await syncMailbox(ctx, accountId);
    return null;
  },
});

// ---- Backfill: the inbox, then 90 days of threads with people, one page per step, its state in comma_sync_state. ----

const BACKFILL_DAYS = 90;
const PAGE_SIZE = 25;
const STEP_MS = 1_000;
const STEP_QUERY = {
  inbox: "in:inbox",
  recent: `newer_than:${BACKFILL_DAYS}d -in:inbox -in:spam -in:trash -in:chats -in:drafts`,
} as const;
type Step = keyof typeof STEP_QUERY;
/** `failures`: the current page's failures in a row. */
export type GmailBackfillState = { run: string; steps: Step[]; pageToken?: string; failures?: number };
/** A page that keeps failing past this many tries in a row stops the backfill, with its error in the logs. */
const PAGE_TRIES = 5;

const connectedGmail = async (ctx: Pick<QueryCtx, "db">) => (await ctx.db.query("comma_accounts")
  .withIndex("by_platform_externalId", (q) => q.eq("platform", "gmail")).collect()).filter((account) => account.credentials !== undefined);

export const backfillState = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { accountId }) => (await syncRow(ctx, accountId, BACKFILL_KEY))?.cursor ?? null,
});

/**
 * Starts a backfill (the inbox, then 90 days) or a resync (the inbox only), from the mailbox's current historyId, so
 * pushes and the backstop pick up from where it began. Connecting Gmail and a forgotten history cursor call this.
 */
export const startBackfill = internalAction({
  args: { accountId: v.id("comma_accounts"), resync: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { accountId, resync }) => {
    const token = await gmailToken(ctx, accountId);
    if (!token) return null;
    const { historyId } = await googleApi<{ historyId: string }>(`${GMAIL_API}/profile`, { token });
    await ctx.runMutation(internal.comma.gmailSync.beginBackfill, { accountId, historyId, steps: resync ? ["inbox"] : ["inbox", "recent"] });
    return null;
  },
});

export const beginBackfill = internalMutation({
  args: { accountId: v.id("comma_accounts"), historyId: v.string(), steps: v.array(v.union(v.literal("inbox"), v.literal("recent"))) },
  returns: v.null(),
  handler: async (ctx, { accountId, historyId, steps }) => {
    const state: GmailBackfillState = { run: String(Date.now()), steps };
    await writeSync(ctx, accountId, HISTORY_KEY, { cursor: historyId });
    await writeSync(ctx, accountId, BACKFILL_KEY, { cursor: JSON.stringify(state) });
    await ctx.scheduler.runAfter(0, internal.comma.gmailSync.backfill, { accountId, run: state.run });
    return null;
  },
});

export const saveBackfill = internalMutation({
  args: { accountId: v.id("comma_accounts"), run: v.string(), state: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { accountId, run, state }) => {
    const current = (await syncRow(ctx, accountId, BACKFILL_KEY))?.cursor;
    if (!current || (JSON.parse(current) as GmailBackfillState).run !== run) return false;
    await writeSync(ctx, accountId, BACKFILL_KEY, { cursor: state });
    return true;
  },
});

/**
 * Reads one page of threads, writes each quietly, saves where it got to, and schedules the next. A rate limit waits;
 * any other error retries the page, since re-reading it is safe, until it has failed PAGE_TRIES times in a row.
 */
export const backfill = internalAction({
  args: { accountId: v.id("comma_accounts"), run: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, run }) => {
    const stored = await ctx.runQuery(internal.comma.gmailSync.backfillState, { accountId });
    const state = stored ? (JSON.parse(stored) as GmailBackfillState) : null;
    const step = state?.steps[0];
    if (!state || state.run !== run || !step) return null;
    const token = await gmailToken(ctx, accountId);
    if (!token) return null;
    let next = state;
    let delay = STEP_MS;
    try {
      const params = new URLSearchParams({ q: STEP_QUERY[step], maxResults: String(PAGE_SIZE), ...(state.pageToken ? { pageToken: state.pageToken } : {}) });
      const page = await googleApi<{ threads?: { id: string }[]; nextPageToken?: string }>(`${GMAIL_API}/threads?${params}`, { token });
      const self = await ctx.runQuery(internal.comma.gmailSync.selfHandles, { accountId });
      for (const thread of page.threads ?? []) await readThread(ctx, token, accountId, thread.id, true, self);
      next = page.nextPageToken ? { run, steps: state.steps, pageToken: page.nextPageToken } : { run, steps: state.steps.slice(1) };
    } catch (error) {
      if (error instanceof GoogleApiError && error.rateLimited) {
        delay = 30_000;
      } else {
        const failures = (state.failures ?? 0) + 1;
        if (failures >= PAGE_TRIES) throw error;
        console.warn(`gmail backfill: page failed (${failures}/${PAGE_TRIES}), retrying`, error);
        next = { ...state, failures };
        delay = 30_000 * failures;
      }
    }
    if (!(await ctx.runMutation(internal.comma.gmailSync.saveBackfill, { accountId, run, state: JSON.stringify(next) }))) return null;
    if (next.steps.length) await ctx.scheduler.runAfter(delay, internal.comma.gmailSync.backfill, { accountId, run });
    return null;
  },
});

// ---- Files backfill: every held thread re-read in full, so messages stored before attachments get theirs. ----

const FILES_PAGE = 25;

export const heldThreads = internalQuery({
  args: { accountId: v.id("comma_accounts"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ threadIds: v.array(v.string()), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, { accountId, cursor }) => {
    const page = await ctx.db.query("comma_conversations")
      .withIndex("by_platform_account_key", (q) => q.eq("platform", "gmail").eq("accountId", accountId))
      .paginate({ numItems: FILES_PAGE, cursor });
    return { threadIds: page.page.flatMap((row) => row.gmail ? [row.gmail.threadId] : []), cursor: page.continueCursor, done: page.isDone };
  },
});

/**
 * Not run on deploy. Start it once for every connected mailbox with
 * `CONVEX_DEPLOYMENT=dev:shiny-gerbil-853 bunx convex run comma/gmailSync:startFilesBackfill '{}'`.
 * Re-reading a thread writes nothing it already holds, so a second run only costs reads.
 */
export const startFilesBackfill = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const accountId of await ctx.runQuery(internal.comma.gmailSync.mailboxes, {})) {
      await ctx.scheduler.runAfter(0, internal.comma.gmailSync.filesBackfill, { accountId, cursor: null });
    }
    return null;
  },
});

/** One page of held threads per step. A rate limit retries the same page 30 seconds on; any other error stops the run, with its error in the logs. */
export const filesBackfill = internalAction({
  args: { accountId: v.id("comma_accounts"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { accountId, cursor }) => {
    const token = await gmailToken(ctx, accountId);
    if (!token) return null;
    const page = await ctx.runQuery(internal.comma.gmailSync.heldThreads, { accountId, cursor });
    const self = await ctx.runQuery(internal.comma.gmailSync.selfHandles, { accountId });
    try {
      for (const threadId of page.threadIds) await readThread(ctx, token, accountId, threadId, true, self);
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.rateLimited)) throw error;
      await ctx.scheduler.runAfter(30_000, internal.comma.gmailSync.filesBackfill, { accountId, cursor });
      return null;
    }
    if (!page.done) await ctx.scheduler.runAfter(STEP_MS, internal.comma.gmailSync.filesBackfill, { accountId, cursor: page.cursor });
    return null;
  },
});

// ---- Push watch and backstop. users.watch lapses after 7 days; the daily cron renews it. ----

/** Every connected mailbox, for the crons. */
export const mailboxes = internalQuery({
  args: {},
  returns: v.array(v.id("comma_accounts")),
  handler: async (ctx) => (await connectedGmail(ctx)).map((account) => account._id),
});

export const saveWatch = internalMutation({
  args: { accountId: v.id("comma_accounts"), expiration: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, expiration }) => {
    await writeSync(ctx, accountId, WATCH_KEY, { cursor: expiration, lastReconcileAt: Date.now() });
    return null;
  },
});

/** Asks Gmail to push the mailbox's changes to its app's Pub/Sub topic. Without one, the backstop alone reads mail. */
export async function watchMailbox(ctx: ActionCtx, accountId: Id<"comma_accounts">): Promise<void> {
  const account = await ctx.runQuery(internal.comma.googleAuth.accountCredentials, { accountId });
  const topicName = account ? pushTopic(account.app) : undefined;
  const token = topicName ? await gmailToken(ctx, accountId) : null;
  if (!topicName || !token) return;
  const watch = await googleApi<{ historyId: string; expiration: string }>(`${GMAIL_API}/watch`, { token, json: { topicName } });
  await ctx.runMutation(internal.comma.gmailSync.saveWatch, { accountId, expiration: watch.expiration });
}

export const watch = internalAction({
  args: { accountId: v.id("comma_accounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }) => {
    await watchMailbox(ctx, accountId);
    return null;
  },
});

/** Runs `work` for every connected mailbox. One mailbox failing does not keep the others from their turn. */
async function eachMailbox(ctx: ActionCtx, work: (ctx: ActionCtx, accountId: Id<"comma_accounts">) => Promise<void>): Promise<void> {
  const failures: unknown[] = [];
  for (const accountId of await ctx.runQuery(internal.comma.gmailSync.mailboxes, {})) {
    await work(ctx, accountId).catch((error: unknown) => failures.push(error));
  }
  if (failures.length) throw new AggregateError(failures, `${failures.length} mailbox(es) failed, first: ${String(failures[0])}`);
}

/** The daily cron: renews every mailbox's watch, days before it lapses. */
export const renewWatches = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await eachMailbox(ctx, watchMailbox);
    return null;
  },
});

/** The 5-minute cron: whatever a push missed lands within 5 minutes. */
export const backstop = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await eachMailbox(ctx, syncMailbox);
    return null;
  },
});
