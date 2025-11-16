import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { ActionResponse } from "../../todoist/actions/utils/todoistClient";

/**
 * Generates task specs for a routine and creates them in Todoist
 * This is the main orchestration action for routine task generation
 */
export const generateAndCreateRoutineTasks = internalAction({
  args: {
    routineId: v.id("routines"),
  },
  handler: async (
    ctx,
    { routineId }
  ): Promise<
    ActionResponse<{ tasksCreated: number; taskIds: string[] }>
  > => {
    try {
      // Generate task specs (creates routineTask records with PENDING todoistTaskId)
      const taskSpecs = await ctx.runMutation(
        internal.routines.internalMutations.generateTasksForRoutine.generateTasksForRoutine,
        { routineId }
      );

      if (taskSpecs.length === 0) {
        return {
          success: true,
          data: { tasksCreated: 0, taskIds: [] },
        };
      }

      const createdTaskIds: string[] = [];
      const failedTasks: string[] = [];

      // Create each task in Todoist
      for (const spec of taskSpecs) {
        const result = await ctx.runAction(
          internal.routines.internalActions.createRoutineTaskInTodoist.createRoutineTaskInTodoist,
          {
            routineTaskId: spec.routineTaskId,
          }
        );

        if (result.success) {
          createdTaskIds.push(result.data.id);
        } else {
          failedTasks.push(spec.routineTaskId);
          console.error(
            `Failed to create Todoist task for routineTask ${spec.routineTaskId}:`,
            result.error
          );
        }
      }

      // If some tasks failed, log but still return success with partial results
      if (failedTasks.length > 0) {
        console.warn(
          `Generated ${taskSpecs.length} task specs, but ${failedTasks.length} failed to create in Todoist`
        );
      }

      return {
        success: true,
        data: {
          tasksCreated: createdTaskIds.length,
          taskIds: createdTaskIds,
        },
      };
    } catch (error) {
      console.error("Failed to generate and create routine tasks:", error);
      return {
        success: false,
        error: "Failed to generate routine tasks. Please try again.",
        code: "GENERATE_ROUTINE_TASKS_FAILED",
      };
    }
  },
});
