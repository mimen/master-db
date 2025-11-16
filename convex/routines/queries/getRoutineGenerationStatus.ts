import { query } from "../../_generated/server";
import { internal } from "../../_generated/api";

/**
 * Get routine generation status for display in sync dialog
 * Returns counts for routines needing generation and pending tasks
 */
export const getRoutineGenerationStatus = query({
  handler: async (ctx) => {
    // Get routines that need generation
    const routinesNeedingGeneration = await ctx.runQuery(
      internal.routines.internalQueries.getRoutinesNeedingGeneration.getRoutinesNeedingGeneration
    );

    // Get all pending routine tasks
    const pendingTasks = await ctx.db
      .query("routineTasks")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return {
      routinesNeedingGeneration: routinesNeedingGeneration.length,
      pendingTasksCount: pendingTasks.length,
    };
  },
});
