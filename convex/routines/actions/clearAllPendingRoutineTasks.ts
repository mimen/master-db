import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import { getTodoistClient } from "../../todoist/actions/utils/todoistClient";

/**
 * Clear all pending routine tasks from Todoist and Convex
 * Preserves completed, missed, and skipped tasks for historical tracking
 * Recalculates completion rates after deletion
 */
export const clearAllPendingRoutineTasks = action({
  handler: async (ctx): Promise<{
    success: boolean;
    data?: { deleted: number; failed: number; skipped: number; routinesRecalculated: number };
    error?: string;
    code?: string;
  }> => {
    try {
      // Get all pending routine tasks
      const pendingTasks = await ctx.runQuery(
        internal.routines.queries.getPendingRoutineTasks.getPendingRoutineTasks
      );

      if (pendingTasks.count === 0) {
        return { success: true, data: { deleted: 0, failed: 0, skipped: 0, routinesRecalculated: 0 } };
      }

      const client = getTodoistClient();
      let deleted = 0;
      let failed = 0;
      let skipped = 0;
      const affectedRoutineIds = new Set<string>();

      // Delete each task from Todoist and Convex
      for (const task of pendingTasks.tasks) {
        affectedRoutineIds.add(task.routineId);

        // Skip tasks not yet in Todoist (still PENDING placeholder)
        if (task.todoistTaskId === "PENDING") {
          await ctx.runMutation(internal.routines.internalMutations.deleteRoutineTask.deleteRoutineTask, {
            routineTaskId: task._id,
          });
          skipped++;
          continue;
        }

        try {
          // Delete from Todoist
          const success = await client.deleteTask(task.todoistTaskId);

          if (success) {
            // Delete routineTask record from Convex
            await ctx.runMutation(internal.routines.internalMutations.deleteRoutineTask.deleteRoutineTask, {
              routineTaskId: task._id,
            });

            // Mark as deleted in todoist_items
            await ctx.runMutation(internal.todoist.internalMutations.updateItem.updateItem, {
              todoistId: task.todoistTaskId,
              updates: {
                is_deleted: true,
                sync_version: Date.now(),
              },
            });

            deleted++;
          } else {
            failed++;
          }
        } catch (error) {
          console.error(`Failed to delete task ${task.todoistTaskId}:`, error);
          failed++;
        }
      }

      // Recalculate completion rates for all affected routines
      let routinesRecalculated = 0;
      for (const routineId of affectedRoutineIds) {
        try {
          await ctx.runMutation(
            internal.routines.internalMutations.recalculateRoutineCompletionRate.recalculateRoutineCompletionRate,
            { routineId }
          );
          routinesRecalculated++;
        } catch (error) {
          console.error(`Failed to recalculate routine ${routineId}:`, error);
        }
      }

      return {
        success: true,
        data: { deleted, failed, skipped, routinesRecalculated },
      };
    } catch (error) {
      console.error("Failed to clear routine tasks:", error);
      return {
        success: false,
        error: "Failed to clear routine tasks. Please try again.",
        code: "CLEAR_ROUTINE_TASKS_FAILED",
      };
    }
  },
});
