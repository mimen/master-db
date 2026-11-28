import { internalMutation } from "../../_generated/server";
import { RoutineTaskStatus } from "../types/status";

/**
 * Mark overdue pending routine tasks as 'missed'
 *
 * Logic:
 * - Tasks overdue by >2 days → mark as missed, unless the Todoist item is checked (→ completed)
 * - Returns list of missed tasks (with todoistTaskIds) for completion in Todoist
 */
export const updateOverdueRoutineTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayMs = 86400000; // 24 hours in milliseconds
    const twoDaysMs = 2 * oneDayMs;

    // Get all pending routine tasks
    const pendingTasks = await ctx.db
      .query("routineTasks")
      .withIndex("by_status", (q) => q.eq("status", RoutineTaskStatus.Pending))
      .collect();

    let missedCount = 0;
    const missedTaskIds: string[] = []; // Todoist task IDs to complete
    const affectedRoutineIds = new Set<string>(); // Routines that need recalculation

    for (const task of pendingTasks) {
      // Skip if not overdue yet
      if (task.dueDate >= now) {
        continue;
      }

      // Calculate how overdue the task is
      const overdueMs = now - task.dueDate;

      // Auto-miss tasks that are overdue by more than 2 days
      if (overdueMs > twoDaysMs) {
        // Todoist is the source of truth: a completion whose webhook never landed is not a miss
        const item = await ctx.db
          .query("todoist_items")
          .withIndex("by_todoist_id", (q) => q.eq("todoist_id", task.todoistTaskId))
          .first();
        if (item?.checked) {
          await ctx.db.patch(task._id, {
            status: RoutineTaskStatus.Completed,
            completedDate: item.completed_at ? Date.parse(item.completed_at) : now,
            updatedAt: now,
          });
          affectedRoutineIds.add(task.routineId);
          continue;
        }

        await ctx.db.patch(task._id, {
          status: RoutineTaskStatus.Missed,
          updatedAt: now,
        });
        missedCount++;
        affectedRoutineIds.add(task.routineId);

        // Collect Todoist task IDs for completion (skip PENDING placeholders)
        if (task.todoistTaskId && task.todoistTaskId !== "PENDING") {
          missedTaskIds.push(task.todoistTaskId);
        }
      }
    }

    return {
      missedCount,
      missedTaskIds,
      affectedRoutineIds: Array.from(affectedRoutineIds),
    };
  },
});
