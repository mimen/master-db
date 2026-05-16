import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

/**
 * Public action wrapper for performIncrementalSync
 * Allows frontend to trigger sync while keeping the actual sync logic internal
 */
export const performIncrementalSync = action({
  handler: async (ctx) => {
    return await ctx.runAction(
      internal.todoist.sync.performIncrementalSync.performIncrementalSync
    );
  },
});
