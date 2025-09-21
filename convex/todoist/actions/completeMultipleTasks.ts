import { randomUUID } from "crypto";

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
    
    try {
      // Build batch commands
      const commands = args.todoistIds.map(todoistId => ({
        type: "item_complete",
        uuid: randomUUID(),
        args: {
          id: todoistId,
        },
      }));

      // Execute all commands at once
      await client.executeCommands(commands);
      
      // Update all items in Convex
      for (const todoistId of args.todoistIds) {
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId,
          updates: {
            checked: 1,
            sync_version: Date.now(),
          },
        });
      }

      return { success: true, data: { completed: args.todoistIds, failed: [] } };
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