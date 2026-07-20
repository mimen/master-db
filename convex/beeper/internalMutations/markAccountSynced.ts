import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Stamp `last_full_sync_at` / `last_incremental_sync_at` on the account after
 * a sync run completes. Also touches the shared `sync_state` table so the
 * dashboard's generic sync widget can see it.
 */
export const markAccountSynced = internalMutation({
  args: {
    account_id: v.string(),
    sync_type: v.union(v.literal("full"), v.literal("incremental")),
  },
  handler: async (ctx, { account_id, sync_type }) => {
    const now = new Date().toISOString();

    const account = await ctx.db
      .query("beeper_accounts")
      .withIndex("by_account_id", (q) => q.eq("account_id", account_id))
      .first();
    if (!account) {
      throw new Error(`markAccountSynced: no account with id ${account_id}`);
    }
    await ctx.db.patch(account._id, {
      last_full_sync_at:
        sync_type === "full" ? now : account.last_full_sync_at,
      last_incremental_sync_at: now,
    });

    const service = `beeper-${account.network.toLowerCase().replace(/\s+/g, "")}`;
    const existing = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", service))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        last_full_sync: sync_type === "full" ? now : existing.last_full_sync,
        last_incremental_sync: now,
      });
    } else {
      await ctx.db.insert("sync_state", {
        service,
        last_full_sync: now,
        last_incremental_sync: now,
      });
    }
  },
});
