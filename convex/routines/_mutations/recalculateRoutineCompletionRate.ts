import { mutation } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Recalculate completion rates for a routine
 * Overall: completed / (completed + missed + skipped) * 100
 * Monthly: same formula, but only tasks in last 30 days
 */
export const recalculateRoutineCompletionRate = mutation({
  args: { routineId: v.id("routines") },
  handler: async (ctx, { routineId }) => {
    // Get the routine
    const routine = await ctx.db.get(routineId);
    if (!routine) {
      throw new Error(`Routine not found: ${routineId}`);
    }

    // Get all routineTasks for this routine
    const allTasks = await ctx.db
      .query("routineTasks")
      .withIndex("by_routine", (q) => q.eq("routineId", routineId))
      .collect();

    // Calculate overall rate
    const completedCount = allTasks.filter(
      (t) => t.status === "completed"
    ).length;
    const missedCount = allTasks.filter((t) => t.status === "missed").length;
    const skippedCount = allTasks.filter(
      (t) => t.status === "skipped"
    ).length;

    const totalForOverall = completedCount + missedCount + skippedCount;
    const completionRateOverall =
      totalForOverall > 0
        ? Math.round((completedCount / totalForOverall) * 100)
        : 100;

    // Calculate monthly rate (last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const monthlyTasks = allTasks.filter((t) => {
      // Use completedDate if available, otherwise use readyDate for pending/missed tasks
      const taskDate = t.completedDate || t.readyDate;
      return taskDate >= thirtyDaysAgo;
    });

    const monthlyCompletedCount = monthlyTasks.filter(
      (t) => t.status === "completed"
    ).length;
    const monthlyMissedCount = monthlyTasks.filter(
      (t) => t.status === "missed"
    ).length;
    const monthlySkippedCount = monthlyTasks.filter(
      (t) => t.status === "skipped"
    ).length;

    const totalForMonthly =
      monthlyCompletedCount + monthlyMissedCount + monthlySkippedCount;
    const completionRateMonth =
      totalForMonthly > 0
        ? Math.round((monthlyCompletedCount / totalForMonthly) * 100)
        : 100;

    // Update the routine with new rates
    await ctx.db.patch(routineId, {
      completionRateOverall,
      completionRateMonth,
    });

    return {
      completionRateOverall,
      completionRateMonth,
      totalTasks: allTasks.length,
      completedCount,
      missedCount,
      skippedCount,
    };
  },
});
