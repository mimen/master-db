import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";
import { ingestAccountSchema } from "../types/ingestApi";

/**
 * Idempotent upsert of a Beeper account row. Keyed by `account_id`
 * (Beeper's internal identifier, e.g. "whatsapp", "telegram").
 *
 * Touches `last_full_sync_at` so callers can use this as a sync heartbeat at
 * the start of a full backfill.
 */
export const upsertAccount = internalMutation({
  args: {
    account: ingestAccountSchema,
    mark_full_sync_started: v.optional(v.boolean()),
  },
  handler: async (ctx, { account, mark_full_sync_started }) => {
    const existing = await ctx.db
      .query("beeper_accounts")
      .withIndex("by_account_id", (q) => q.eq("account_id", account.account_id))
      .first();

    const now = new Date().toISOString();
    const row = {
      account_id: account.account_id,
      network: account.network,
      display_name: account.display_name,
      phone_number: account.phone_number,
      is_active: account.is_active ?? true,
      last_full_sync_at: mark_full_sync_started
        ? now
        : existing?.last_full_sync_at,
      last_incremental_sync_at: existing?.last_incremental_sync_at,
      raw: account.raw,
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("beeper_accounts", row);
  },
});
