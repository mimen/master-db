import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteTask = action({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    try {
      const client = getTodoistClient();

      // Delete task using SDK
      const success = await client.deleteTask(args.taskId);

      if (success) {
        // Mark as deleted in Convex
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.taskId,
          updates: {
            is_deleted: true,
            sync_version: Date.now(),
          },
        });
      }

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