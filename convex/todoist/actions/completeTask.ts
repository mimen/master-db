import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const completeTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<boolean>> => {
    try {
      const client = getTodoistClient();

      // Complete task using SDK
      const success = await client.closeTask(args.todoistId);

      if (success) {
        // Update in Convex
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates: {
            checked: true,
            completed_at: new Date().toISOString(),
            sync_version: Date.now(),
          },
        });
      }

      return { success: true, data: success };
    } catch (error) {
      console.error("Failed to complete task:", error);
      return {
        success: false,
        error: "Failed to complete task. Please try again.",
        code: "COMPLETE_TASK_FAILED",
      };
    }
  },
});