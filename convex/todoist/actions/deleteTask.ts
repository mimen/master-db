import { randomUUID } from "crypto";

import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteTask = action({
  args: {
    todoistId: v.string(),
  },
  handler: async (ctx, args): Promise<ActionResponse<void>> => {
    try {
      const client = getTodoistClient();
      const commandId = randomUUID();

      // Execute command via API v1
      await client.executeCommands([{
        type: "item_delete",
        uuid: commandId,
        args: {
          id: args.todoistId,
        },
      }]);

      // Soft delete in Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          is_deleted: 1,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: undefined };
    } catch (error: any) {
      console.error("Failed to delete task:", error);
      return {
        success: false,
        error: "Failed to delete task. Please try again.",
        code: "DELETE_TASK_FAILED",
      };
    }
  },
});