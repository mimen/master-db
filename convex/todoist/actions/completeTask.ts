import { randomUUID } from "crypto";

import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const completeTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();
      const commandId = randomUUID();

      // Execute command via API v1
      await client.executeCommands([{
        type: "item_complete",
        uuid: commandId,
        args: {
          id: args.todoistId,
        },
      }]);

      // Update in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: 1,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: undefined };
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