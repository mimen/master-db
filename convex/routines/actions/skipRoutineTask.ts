import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import { getTodoistClient } from "../../todoist/actions/utils/todoistClient";

/**
 * Skip a routine task
 * - Marks task as "missed" in Convex
 * - Completes task in Todoist (to remove from active list while keeping history)
 * - Recalculates routine completion rate
 */
export const skipRoutineTask = action({
  args: {
    routineTaskId: v.id("routineTasks"),
  },
  handler: async (ctx, { routineTaskId }): Promise<{
    success: boolean;
    error?: string;
    code?: string;
  }> => {
    try {
      // Get the routine task
      const routineTask = await ctx.runQuery(
        internal.routines.internalQueries.getRoutineTask.getRoutineTask,
        { routineTaskId }
      );

      if (!routineTask) {
        return {
          success: false,
          error: "Routine task not found",
          code: "ROUTINE_TASK_NOT_FOUND",
        };
      }

      // Mark as skipped in Convex
      await ctx.runMutation(
        internal.routines.internalMutations.markRoutineTaskSkipped.markRoutineTaskSkipped,
        { routineTaskId }
      );

      // Complete task in Todoist (if it exists and isn't a PENDING placeholder)
      if (routineTask.todoistTaskId && routineTask.todoistTaskId !== "PENDING") {
        try {
          const client = getTodoistClient();
          const success = await client.closeTask(routineTask.todoistTaskId);

          if (!success) {
            console.warn(
              `Failed to complete task in Todoist: ${routineTask.todoistTaskId}, but marked as skipped in Convex`
            );
          }
        } catch (error) {
          console.error("Error completing task in Todoist:", error);
          // Continue anyway - the task is marked as skipped in Convex
        }
      }

      // Recalculate completion rate
      await ctx.runMutation(
        internal.routines.internalMutations.recalculateRoutineCompletionRate.recalculateRoutineCompletionRate,
        { routineId: routineTask.routineId }
      );

      return { success: true };
    } catch (error) {
      console.error("Failed to skip routine task:", error);
      return {
        success: false,
        error: "Failed to skip routine task. Please try again.",
        code: "SKIP_ROUTINE_TASK_FAILED",
      };
    }
  },
});
