import { query } from "../../_generated/server";

/**
 * Get all pending routine tasks
 * Used for UI display and clear action processing
 */
export const getPendingRoutineTasks = query({
  handler: async (ctx) => {
    const pendingTasks = await ctx.db
      .query("routineTasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return {
      tasks: pendingTasks,
      count: pendingTasks.length,
    };
  },
});
