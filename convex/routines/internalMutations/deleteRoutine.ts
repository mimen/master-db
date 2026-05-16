import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { RoutineTaskStatus } from "../types/status";

export const deleteRoutine = internalMutation({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (ctx, { routineId }) => {
    const routine = await ctx.db.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} not found`);
    }

    // Mark routine as deferred (soft delete)
    await ctx.db.patch(routineId, {
      defer: true,
      deferralDate: Date.now(),
      updatedAt: Date.now(),
    });

    // Mark all pending routineTasks as skipped
    const pendingTasks = await ctx.db
      .query("routineTasks")
      .withIndex("routine_pending_tasks", (q) =>
        q.eq("routineId", routineId).eq("status", RoutineTaskStatus.Pending)
      )
      .collect();

    const now = Date.now();
    for (const task of pendingTasks) {
      await ctx.db.patch(task._id, {
        status: RoutineTaskStatus.Skipped,
        updatedAt: now,
      });
    }

    return routineId;
  },
});
