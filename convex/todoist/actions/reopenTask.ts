import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const reopenTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    try {
      const client = getTodoistClient();

      // Reopen task via Todoist API
      const success = await client.reopenTask(args.todoistId);

      if (!success) {
        return {
          success: false,
          error: "Failed to reopen task on Todoist",
          code: "TODOIST_API_FAILED",
        };
      }

      // Update task state in Convex DB
      await ctx.runMutation(internal.todoist.internalMutations.updateItem.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: false,
          completed_at: null,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: success };
    } catch (error) {
      console.error("Failed to reopen task:", error);
      return {
        success: false,
        error: "Failed to reopen task. Please try again.",
        code: "REOPEN_TASK_FAILED",
      };
    }
  },
});