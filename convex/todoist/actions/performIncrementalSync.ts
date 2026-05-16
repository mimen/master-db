import { internal } from "../../_generated/api";
import { authedAction } from "../../_lib/authed";

/**
 * Public action wrapper for performIncrementalSync
 * Allows frontend to trigger sync while keeping the actual sync logic internal
 */
export const performIncrementalSync = authedAction({
  handler: async (ctx) => {
    return await ctx.runAction(
      internal.todoist.sync.performIncrementalSync.performIncrementalSync
    );
  },
});
