import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const reopenTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    // STEP 1: OPTIMISTIC UPDATE - Reopen task immediately for instant UI feedback
    await ctx.runMutation(internal.todoist.mutations.updateItem, {
      todoistId: args.todoistId,
      updates: {
        checked: false,
        completed_at: null,
        sync_version: Date.now(),
      },
    });

    try {
      const client = getTodoistClient();

      // STEP 2: REAL UPDATE - Reopen task using SDK (this may take 200-500ms)
      const success = await client.reopenTask(args.todoistId);

      if (!success) {
        // STEP 3a: ROLLBACK - API returned false, restore completed state
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates: {
            checked: true,
            completed_at: new Date().toISOString(),
            sync_version: Date.now(),
          },
        });

        return {
          success: false,
          error: "Failed to reopen task on Todoist",
          code: "TODOIST_API_FAILED",
        };
      }

      // Success! The optimistic update was correct, no action needed
      return { success: true, data: success };
    } catch (error) {
      // STEP 3b: ROLLBACK - Exception occurred, restore completed state
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: true,
          completed_at: new Date().toISOString(),
          sync_version: Date.now(),
        },
      });

      console.error("Failed to reopen task:", error);
      return {
        success: false,
        error: "Failed to reopen task. Please try again.",
        code: "REOPEN_TASK_FAILED",
      };
    }
  },
});