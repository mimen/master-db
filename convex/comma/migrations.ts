import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "../_generated/server";
import type { CommaPlatform } from "../schema/comma/validators";

import { ensureAccount, soleAccountScope } from "./accounts";
import { conversationKind, IMESSAGE_ACCOUNT, slack } from "./conversationIdentity";
import { findByKey } from "./conversationLookup";
import { attachmentBackfill, messageBackfill } from "./messageShape";
import { refreshLastMessage } from "./pendingSends";
import { currentKey, messageKey, sameReaction } from "./reactions";
import { countReplies } from "./slackSync";

/**
 * The accounts backfill: stamps every iMessage row from before accounts with the iMessage account and nests
 * messages' and attachments' flat iMessage fields under `imessage`. Idempotent and paged. Run the dry run first:
 *
 *   bunx convex run comma/migrations:runAccountsBackfill '{"dryRun":true}'
 *   bunx convex run comma/migrations:runAccountsBackfill '{"dryRun":false}'
 *
 * Once a real run reports zero changes, the legacy indexes and readers in conversationLookup.ts can go.
 */

const TABLES = ["comma_conversations", "comma_chat_aliases", "comma_messages", "comma_attachments", "comma_scheduled"] as const;
const table = v.union(...TABLES.map((name) => v.literal(name)));
type Table = (typeof TABLES)[number];

const pageResult = v.object({ scanned: v.number(), changed: v.number(), cursor: v.string(), isDone: v.boolean() });

async function patchPage(ctx: MutationCtx, name: Table, accountId: Id<"comma_accounts">, cursor: string | null, numItems: number, dryRun: boolean) {
  const stamp = (row: { platform?: CommaPlatform; accountId?: Id<"comma_accounts"> }) =>
    row.platform !== undefined && row.platform !== "imessage" ? null
      : row.accountId === undefined || row.platform === undefined ? { platform: "imessage" as const, accountId: row.accountId ?? accountId } : null;
  const page = await ctx.db.query(name).paginate({ cursor, numItems });
  let changed = 0;
  for (const row of page.page) {
    const patch = name === "comma_messages" ? messageBackfill(row as Doc<"comma_messages">, accountId)
      : name === "comma_attachments" ? attachmentBackfill(row as Doc<"comma_attachments">, accountId)
        : stamp(row);
    if (!patch) continue;
    changed++;
    if (!dryRun) await ctx.db.patch(row._id, patch);
  }
  return { scanned: page.page.length, changed, cursor: page.continueCursor, isDone: page.isDone };
}

export const backfillAccountsPage = internalMutation({
  args: { table, cursor: v.union(v.string(), v.null()), limit: v.optional(v.number()), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, { table, cursor, limit, dryRun }) => {
    const account = await ensureAccount(ctx, IMESSAGE_ACCOUNT);
    return await patchPage(ctx, table, account._id, cursor, Math.min(limit ?? 200, 500), dryRun);
  },
});

const pageRef = makeFunctionReference<"mutation", { table: Table; cursor: string | null; limit?: number; dryRun: boolean }, {
  scanned: number; changed: number; cursor: string; isDone: boolean;
}>("comma/migrations:backfillAccountsPage");

/** Runs every table's pages in order and reports what changed, or with dryRun what would. */
export const runAccountsBackfill = internalAction({
  args: { dryRun: v.boolean(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ table, scanned: v.number(), changed: v.number() })),
  handler: async (ctx, { dryRun, limit }) => {
    const report: { table: Table; scanned: number; changed: number }[] = [];
    for (const name of TABLES) {
      let cursor: string | null = null;
      const totals = { table: name, scanned: 0, changed: 0 };
      for (;;) {
        const page: { scanned: number; changed: number; cursor: string; isDone: boolean } =
          await ctx.runMutation(pageRef, { table: name, cursor, limit, dryRun });
        totals.scanned += page.scanned;
        totals.changed += page.changed;
        if (page.isDone) break;
        cursor = page.cursor;
      }
      report.push(totals);
    }
    return report;
  },
});

/**
 * The kinds backfill: stamps `kind` on every conversation from before kinds, read off its `isGroup`. Idempotent and
 * paged. Run the dry run first:
 *
 *   bunx convex run comma/migrations:runKindsBackfill '{"dryRun":true}'
 *   bunx convex run comma/migrations:runKindsBackfill '{"dryRun":false}'
 *
 * Once a real run reports zero changes, `kind` can be required and `conversationKind`'s fallback can go.
 */
export const backfillKindsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.optional(v.number()), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, { cursor, limit, dryRun }) => {
    const page = await ctx.db.query("comma_conversations").paginate({ cursor, numItems: Math.min(limit ?? 200, 500) });
    let changed = 0;
    for (const row of page.page) {
      if (row.kind !== undefined) continue;
      changed++;
      if (!dryRun) await ctx.db.patch(row._id, { kind: conversationKind(row) });
    }
    return { scanned: page.page.length, changed, cursor: page.continueCursor, isDone: page.isDone };
  },
});

const kindsPageRef = makeFunctionReference<"mutation", { cursor: string | null; limit?: number; dryRun: boolean }, {
  scanned: number; changed: number; cursor: string; isDone: boolean;
}>("comma/migrations:backfillKindsPage");

/** Runs every page and reports what changed, or with dryRun what would. */
export const runKindsBackfill = internalAction({
  args: { dryRun: v.boolean(), limit: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), changed: v.number() }),
  handler: async (ctx, { dryRun, limit }) => {
    const totals = { scanned: 0, changed: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: { scanned: number; changed: number; cursor: string; isDone: boolean } =
        await ctx.runMutation(kindsPageRef, { cursor, limit, dryRun });
      totals.scanned += page.scanned;
      totals.changed += page.changed;
      if (page.isDone) return totals;
      cursor = page.cursor;
    }
  },
});

/**
 * The unlisted backfill: stamps `unlisted` on every email thread and every Slack thread Milad doesn't follow from
 * before the Messages list's index skipped them. Until it runs the list still drops them, only after reading them.
 * Idempotent and paged. Run the dry run first:
 *
 *   bunx convex run comma/migrations:runUnlistedBackfill '{"dryRun":true}'
 *   bunx convex run comma/migrations:runUnlistedBackfill '{"dryRun":false}'
 *
 * Once a real run reports zero changes, the list's own email-thread filter can go.
 */
export const backfillUnlistedPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.optional(v.number()), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, { cursor, limit, dryRun }) => {
    const page = await ctx.db.query("comma_conversations").paginate({ cursor, numItems: Math.min(limit ?? 200, 500) });
    let changed = 0;
    for (const row of page.page) {
      const unlisted = conversationKind(row) === "emailThread" || (row.slack?.threadTs !== undefined && row.slack.following === false);
      if (!unlisted || row.unlisted) continue;
      changed++;
      if (!dryRun) await ctx.db.patch(row._id, { unlisted: true });
    }
    return { scanned: page.page.length, changed, cursor: page.continueCursor, isDone: page.isDone };
  },
});

const unlistedPageRef = makeFunctionReference<"mutation", { cursor: string | null; limit?: number; dryRun: boolean }, {
  scanned: number; changed: number; cursor: string; isDone: boolean;
}>("comma/migrations:backfillUnlistedPage");

/** Runs every page and reports what changed, or with dryRun what would. */
export const runUnlistedBackfill = internalAction({
  args: { dryRun: v.boolean(), limit: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), changed: v.number() }),
  handler: async (ctx, { dryRun, limit }) => {
    const totals = { scanned: 0, changed: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: { scanned: number; changed: number; cursor: string; isDone: boolean } =
        await ctx.runMutation(unlistedPageRef, { cursor, limit, dryRun });
      totals.scanned += page.scanned;
      totals.changed += page.changed;
      if (page.isDone) return totals;
      cursor = page.cursor;
    }
  },
});

/**
 * The Slack threads backfill, for rows from before S3. It stamps each `th:` conversation stored as a group with
 * `kind: "thread"` and `following: true` (S1 kept only threads Milad was in), and moves each reply kept inline in a
 * DM or group DM into its thread's own conversation, then counts every thread's replies onto its root. Readers serve
 * both forms meanwhile: `conversationKind` reads a thread off `slack.threadTs`, and a DM shows its inline replies as
 * it did. Idempotent and paged; a DM page reads every message of its conversations, so pages stay small. Run the dry
 * run first:
 *
 *   bunx convex run comma/migrations:runSlackThreadsBackfill '{"dryRun":true}'
 *   bunx convex run comma/migrations:runSlackThreadsBackfill '{"dryRun":false}'
 */
export const backfillSlackThreadsPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.optional(v.number()), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, { cursor, limit, dryRun }) => {
    const page = await ctx.db.query("comma_conversations").paginate({ cursor, numItems: Math.min(limit ?? 25, 100) });
    let changed = 0;
    for (const row of page.page) {
      if (row.platform !== "slack" || !row.slack || !row.accountId) continue;
      if (row.slack.threadTs) {
        if (row.kind === "thread" && row.slack.following !== undefined) continue;
        changed++;
        if (dryRun) continue;
        await ctx.db.patch(row._id, { kind: "thread", slack: { ...row.slack, following: row.slack.following ?? true } });
        await countReplies(ctx, row.accountId, row._id);
        continue;
      }
      if (row.kind === "channel") continue;
      const replies = (await ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", row._id)).collect())
        .filter((message) => message.threadRef !== undefined);
      changed += replies.length;
      if (dryRun || replies.length === 0) continue;
      const self = (await ctx.db.get(row.accountId))?.selfHandles.find((handle) => handle.startsWith("slack:"));
      const threads = new Set<Id<"comma_conversations">>();
      for (const message of replies) {
        const threadId = await threadConversation(ctx, row, message.threadRef!, replies, self);
        await ctx.db.patch(message._id, { conversationId: threadId });
        threads.add(threadId);
      }
      await refreshLastMessage(ctx, row._id);
      for (const threadId of threads) {
        await refreshLastMessage(ctx, threadId);
        await countReplies(ctx, row.accountId, threadId);
      }
    }
    return { scanned: page.page.length, changed, cursor: page.continueCursor, isDone: page.isDone };
  },
});

/** The thread a DM reply moves into, made as ingest would make it: a followed thread listing its authors. */
async function threadConversation(
  ctx: MutationCtx, dm: Doc<"comma_conversations">, threadTs: string, replies: Doc<"comma_messages">[], self: string | undefined,
): Promise<Id<"comma_conversations">> {
  const { channel } = dm.slack!;
  const ref = { type: "thread" as const, channel, threadTs };
  const scope = { platform: "slack" as const, accountId: dm.accountId! };
  const existing = await findByKey(ctx, scope, slack.conversationKey(ref));
  if (existing) return existing._id;
  const authors = [...new Set(replies.filter((reply) => reply.threadRef === threadTs).map((reply) => reply.sender?.address))]
    .filter((address): address is string => address !== undefined && address !== self);
  return await ctx.db.insert("comma_conversations", {
    platform: "slack", accountId: dm.accountId, conversationKey: slack.conversationKey(ref), kind: "thread", isGroup: true,
    slack: { channel, threadTs, following: true }, displayName: "Slack", rawDisplayName: "",
    participants: authors.map((address) => ({ address, name: null })), isSpam: false, lastMessageAt: 0, updatedAt: Date.now(),
  });
}

const slackThreadsPageRef = makeFunctionReference<"mutation", { cursor: string | null; limit?: number; dryRun: boolean }, {
  scanned: number; changed: number; cursor: string; isDone: boolean;
}>("comma/migrations:backfillSlackThreadsPage");

/** Runs every page and reports what changed (threads restamped plus replies moved), or with dryRun what would. */
export const runSlackThreadsBackfill = internalAction({
  args: { dryRun: v.boolean(), limit: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), changed: v.number() }),
  handler: async (ctx, { dryRun, limit }) => {
    const totals = { scanned: 0, changed: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: { scanned: number; changed: number; cursor: string; isDone: boolean } =
        await ctx.runMutation(slackThreadsPageRef, { cursor, limit, dryRun });
      totals.scanned += page.scanned;
      totals.changed += page.changed;
      if (page.isDone) return totals;
      cursor = page.cursor;
    }
  },
});

/**
 * The reaction keys backfill, for rows from before G4: rewrites each reaction's `targetKey` from `platform:guid` to
 * messageKey's `platform:account:guid`, with its conversation's account. Until it runs, reactions on older messages
 * do not show. Where the new key already holds the same sender's state, because an event landed between the deploy
 * and this run, the newer state stays. Idempotent and paged. Run the dry run first:
 *
 *   bunx convex run comma/migrations:runReactionKeysBackfill '{"dryRun":true}'
 *   bunx convex run comma/migrations:runReactionKeysBackfill '{"dryRun":false}'
 */
export const backfillReactionKeysPage = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), limit: v.optional(v.number()), dryRun: v.boolean() },
  returns: pageResult,
  handler: async (ctx, { cursor, limit, dryRun }) => {
    const page = await ctx.db.query("comma_reactions").paginate({ cursor, numItems: Math.min(limit ?? 200, 500) });
    let changed = 0;
    for (const row of page.page) {
      const prefix = `${row.platform}:`;
      const rest = row.targetKey.startsWith(prefix) ? row.targetKey.slice(prefix.length) : null;
      if (rest === null || ctx.db.normalizeId("comma_accounts", rest.split(":")[0]!) !== null) continue;
      const accountId = (await ctx.db.get(row.conversationId))?.accountId ?? (await soleAccountScope(ctx, row.platform)).accountId;
      if (!accountId) continue;
      changed++;
      if (dryRun) continue;
      const targetKey = messageKey(row.platform, accountId, rest);
      const twin = (await ctx.db.query("comma_reactions").withIndex("by_targetKey", (q) => q.eq("targetKey", targetKey)).collect())
        .find((other) => sameReaction({ ...other, key: currentKey(other.key) }, { ...row, key: currentKey(row.key) }));
      if (twin && twin.at >= row.at) {
        await ctx.db.delete(row._id);
        continue;
      }
      if (twin) await ctx.db.delete(twin._id);
      await ctx.db.patch(row._id, { targetKey });
    }
    return { scanned: page.page.length, changed, cursor: page.continueCursor, isDone: page.isDone };
  },
});

const reactionKeysPageRef = makeFunctionReference<"mutation", { cursor: string | null; limit?: number; dryRun: boolean }, {
  scanned: number; changed: number; cursor: string; isDone: boolean;
}>("comma/migrations:backfillReactionKeysPage");

/** Runs every page and reports what changed, or with dryRun what would. */
export const runReactionKeysBackfill = internalAction({
  args: { dryRun: v.boolean(), limit: v.optional(v.number()) },
  returns: v.object({ scanned: v.number(), changed: v.number() }),
  handler: async (ctx, { dryRun, limit }) => {
    const totals = { scanned: 0, changed: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: { scanned: number; changed: number; cursor: string; isDone: boolean } =
        await ctx.runMutation(reactionKeysPageRef, { cursor, limit, dryRun });
      totals.scanned += page.scanned;
      totals.changed += page.changed;
      if (page.isDone) return totals;
      cursor = page.cursor;
    }
  },
});
