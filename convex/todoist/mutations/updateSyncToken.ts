import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

export const updateSyncToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();

    if (syncState) {
      await ctx.db.patch(syncState._id, {
        last_sync_token: token,
        last_incremental_sync: new Date().toISOString(),
      });
    }
  },
});