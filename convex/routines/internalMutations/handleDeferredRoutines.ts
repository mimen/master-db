import { internalMutation } from "../../_generated/server";
import { RoutineTaskStatus } from "../types/status";

/**
 * Mark all pending tasks of deferred routines as 'deferred'
 *
 * This ensures that when a routine is deferred, all its pending tasks
 * are marked appropriately and won't be counted as missed or completed.
 */
export const handleDeferredRoutines = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all deferred routines
    const deferredRoutines = await ctx.db
      .query("routines")
      .withIndex("by_defer", (q) => q.eq("defer", true))
      .collect();

    let deferredTaskCount = 0;

    for (const routine of deferredRoutines) {
      // Get all pending tasks for this routine
      const pendingTasks = await ctx.db
        .query("routineTasks")
        .withIndex("routine_pending_tasks", (q) =>
          q.eq("routineId", routine._id).eq("status", RoutineTaskStatus.Pending)
        )
        .collect();

      // Mark all pending tasks as deferred
      for (const task of pendingTasks) {
        await ctx.db.patch(task._id, {
          status: RoutineTaskStatus.Deferred,
          updatedAt: now,
        });
        deferredTaskCount++;
      }
    }

    return { deferredTaskCount, deferredRoutinesCount: deferredRoutines.length };
  },
});
