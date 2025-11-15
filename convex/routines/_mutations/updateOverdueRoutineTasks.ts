import { internalMutation } from "../../_generated/server";
import { RoutineTaskStatus } from "../types/status";
import { Frequency, frequencyToDays, isHighFrequency } from "../types/frequency";

/**
 * Mark overdue pending routine tasks as 'missed'
 *
 * Logic:
 * - Daily/Twice a Week: Mark missed if overdue by >1 day
 * - Others: Mark missed if overdue by > frequency interval
 */
export const updateOverdueRoutineTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayMs = 86400000; // 24 hours in milliseconds

    // Get all pending routine tasks
    const pendingTasks = await ctx.db
      .query("routineTasks")
      .withIndex("by_status", (q) => q.eq("status", RoutineTaskStatus.Pending))
      .collect();

    let missedCount = 0;

    for (const task of pendingTasks) {
      // Skip if not overdue yet
      if (task.dueDate >= now) {
        continue;
      }

      // Get the routine to determine frequency
      const routine = await ctx.db.get(task.routineId);
      if (!routine) {
        console.warn(`Routine ${task.routineId} not found for task ${task._id}`);
        continue;
      }

      // Calculate how overdue the task is
      const overdueMs = now - task.dueDate;

      // Determine if task should be marked as missed
      let shouldMarkMissed = false;

      if (isHighFrequency(routine.frequency as Frequency)) {
        // High frequency (Daily, Twice a Week): mark missed after 1 day
        shouldMarkMissed = overdueMs > oneDayMs;
      } else {
        // Lower frequency: mark missed after the frequency interval
        const frequencyMs = frequencyToDays(routine.frequency as Frequency) * oneDayMs;
        shouldMarkMissed = overdueMs > frequencyMs;
      }

      if (shouldMarkMissed) {
        await ctx.db.patch(task._id, {
          status: RoutineTaskStatus.Missed,
          updatedAt: now,
        });
        missedCount++;
      }
    }

    return { missedCount };
  },
});
