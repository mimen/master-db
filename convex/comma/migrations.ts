import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "../_generated/server";
import type { CommaPlatform } from "../schema/comma/validators";

import { ensureAccount } from "./accounts";
import { conversationKind, IMESSAGE_ACCOUNT } from "./conversationIdentity";
import { attachmentBackfill, messageBackfill } from "./messageShape";

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
