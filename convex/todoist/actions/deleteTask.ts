import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteTask = action({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    // Store original values for rollback
    const existing = await ctx.runQuery(
      internal.todoist.queries.getItemByTodoistId,
      {
        todoistId: args.taskId
      }
    );

    // STEP 1: OPTIMISTIC UPDATE - Mark as deleted immediately for instant UI feedback
    await ctx.runMutation(internal.todoist.mutations.updateItem, {
      todoistId: args.taskId,
      updates: {
        is_deleted: true,
        sync_version: Date.now(),
      },
    });

    try {
      const client = getTodoistClient();

      // STEP 2: REAL UPDATE - Delete task using SDK (this may take 200-500ms)
      const success = await client.deleteTask(args.taskId);

      if (!success) {
        // STEP 3a: ROLLBACK - API returned false, restore task
        if (existing) {
          await ctx.runMutation(internal.todoist.mutations.updateItem, {
            todoistId: args.taskId,
            updates: {
              is_deleted: false,
              sync_version: Date.now(),
            },
          });
        }

        return {
          success: false,
          error: "Failed to delete task on Todoist",
          code: "TODOIST_API_FAILED",
        };
      }

      // Success! The optimistic update was correct, no action needed
      return { success: true, data: success };
    } catch (error) {
      // STEP 3b: ROLLBACK - Exception occurred, restore task
      if (existing) {
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.taskId,
          updates: {
            is_deleted: false,
            sync_version: Date.now(),
          },
        });
      }

      console.error("Failed to delete task:", error);
      return {
        success: false,
        error: "Failed to delete task. Please try again.",
        code: "DELETE_TASK_FAILED",
      };
    }
  },
});