import { randomUUID } from "crypto";

import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const reopenTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();
      const commandId = randomUUID();
      
      // Execute command via API v1
      await client.executeCommands([{
        type: "item_uncomplete",
        uuid: commandId,
        args: {
          id: args.todoistId,
        },
      }]);

      // Update in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          checked: 0,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: undefined };
    } catch (error: any) {
      console.error("Failed to reopen task:", error);
      return {
        success: false,
        error: "Failed to reopen task. Please try again.",
        code: "REOPEN_TASK_FAILED",
      };
    }
  },
});