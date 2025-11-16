import { internalQuery } from "../../_generated/server";
import { RoutineTaskStatus } from "../types/status";
import { Frequency } from "../types/frequency";
import { addDays } from "../utils/dateCalculation";

export const getRoutinesNeedingGeneration = internalQuery({
  handler: async (ctx) => {
    // Get all active (non-deferred) routines
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_defer", (q) => q.eq("defer", false))
      .collect();

    const routinesNeedingGeneration = [];
    const sevenDaysFromNow = addDays(Date.now(), 7);

    for (const routine of routines) {
      // Get pending tasks for this routine
      const pendingTasks = await ctx.db
        .query("routineTasks")
        .withIndex("routine_pending_tasks", (q) =>
          q.eq("routineId", routine._id).eq("status", RoutineTaskStatus.Pending)
        )
        .collect();

      // Count tasks within next 7 days
      const tasksInWindow = pendingTasks.filter(
        (task) => task.readyDate <= sevenDaysFromNow
      );

      // Determine if routine needs generation based on frequency
      let needsGeneration = false;

      if (routine.frequency === Frequency.Daily) {
        // Should have at least 3 pending tasks (to maintain buffer)
        needsGeneration = tasksInWindow.length < 3;
      } else if (routine.frequency === Frequency.TwiceAWeek) {
        // Should have at least 2 pending tasks
        needsGeneration = tasksInWindow.length < 2;
      } else {
        // Weekly+: Should have at least 1 pending task
        needsGeneration = tasksInWindow.length < 1;
      }

      if (needsGeneration) {
        routinesNeedingGeneration.push(routine);
      }
    }

    return routinesNeedingGeneration;
  },
});
