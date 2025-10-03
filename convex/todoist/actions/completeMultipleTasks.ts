import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const completeMultipleTasks = action({
  args: {
    todoistIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<{ completed: string[]; failed: string[] }>> => {
    const client = getTodoistClient();
    const completed: string[] = [];
    const failed: string[] = [];

    try {
      // Complete each task individually using SDK
      for (const todoistId of args.todoistIds) {
        try {
          const success = await client.closeTask(todoistId);

          if (success) {
            // Update in Convex
            await ctx.runMutation(internal.todoist.mutations.updateItem, {
              todoistId,
              updates: {
                checked: true,
                completed_at: new Date().toISOString(),
                sync_version: Date.now(),
              },
            });
            completed.push(todoistId);
          } else {
            failed.push(todoistId);
          }
        } catch (error) {
          console.error(`Failed to complete task ${todoistId}:`, error);
          failed.push(todoistId);
        }
      }

      return {
        success: true,
        data: { completed, failed }
      };
    } catch (error) {
      console.error("Failed to complete tasks:", error);
      return {
        success: false,
        error: "Failed to complete tasks. Please try again.",
        code: "BATCH_COMPLETE_FAILED",
      };
    }
  },
});