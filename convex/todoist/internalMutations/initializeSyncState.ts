import { internalMutation } from "../../_generated/server";

export const initializeSyncState = internalMutation({
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();

    if (!existing) {
      await ctx.db.insert("sync_state", {
        service: "todoist",
        last_sync_token: undefined,
        last_full_sync: new Date().toISOString(),
      });
    }
  },
});