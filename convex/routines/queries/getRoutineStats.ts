import { v } from "convex/values";
import { query } from "../../_generated/server";
import { RoutineTaskStatus } from "../types/status";

/**
 * Get detailed statistics for a routine
 * Returns completion rates and recent task history
 */
export const getRoutineStats = query({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (ctx, { routineId }) => {
    // Get the routine
    const routine = await ctx.db.get(routineId);
    if (!routine) {
      throw new Error(`Routine not found: ${routineId}`);
    }

    // Get all routine tasks
    const allTasks = await ctx.db
      .query("routineTasks")
      .withIndex("by_routine", (q) => q.eq("routineId", routineId))
      .collect();

    // Filter to recent tasks (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentTasks = allTasks
      .filter((task) => task.readyDate >= thirtyDaysAgo)
      .sort((a, b) => b.readyDate - a.readyDate); // Most recent first

    // Find next scheduled task date (earliest pending task)
    const pendingTasks = allTasks
      .filter((task) => task.status === RoutineTaskStatus.Pending)
      .sort((a, b) => a.readyDate - b.readyDate); // Earliest first
    const nextTaskDate = pendingTasks.length > 0 ? pendingTasks[0].readyDate : null;

    return {
      routine,
      completionRateOverall: routine.completionRateOverall,
      completionRateMonth: routine.completionRateMonth,
      recentTasks,
      nextTaskDate,
      totalTasks: allTasks.length,
      pendingCount: allTasks.filter((t) => t.status === RoutineTaskStatus.Pending).length,
      completedCount: allTasks.filter((t) => t.status === RoutineTaskStatus.Completed).length,
      missedCount: allTasks.filter((t) => t.status === RoutineTaskStatus.Missed).length,
    };
  },
});
