import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { authedAction } from "../../_lib/authed";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteTask = authedAction({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    try {
      const client = getTodoistClient();

      // Delete task via Todoist API
      const success = await client.deleteTask(args.taskId);

      if (!success) {
        return {
          success: false,
          error: "Failed to delete task on Todoist",
          code: "TODOIST_API_FAILED",
        };
      }

      // Mark as deleted in Convex DB
      await ctx.runMutation(internal.todoist.internalMutations.updateItem.updateItem, {
        todoistId: args.taskId,
        updates: {
          is_deleted: true,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: success };
    } catch (error) {
      console.error("Failed to delete task:", error);
      return {
        success: false,
        error: "Failed to delete task. Please try again.",
        code: "DELETE_TASK_FAILED",
      };
    }
  },
});