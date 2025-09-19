import { internalQuery } from "../_generated/server";

export const getSyncState = internalQuery({
  handler: async (ctx) => {
    return ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();
  },
});