import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { authedQuery } from "../../_lib/authed";

/**
 * Get routine generation status for display in sync dialog
 * Returns counts for routines needing generation and pending tasks
 */
export const getRoutineGenerationStatus = authedQuery({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    // Get routines that need generation
    const routinesNeedingGeneration = await ctx.runQuery(
      internal.routines.internalQueries.getRoutinesNeedingGeneration.getRoutinesNeedingGeneration,
      { now: now ?? Date.now() }
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
