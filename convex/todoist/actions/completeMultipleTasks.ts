import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
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
        uuid: crypto.randomUUID(),
        args: {
          id: todoistId,
        },
      }));

      // Execute all commands at once
      const response = await client.executeCommands(commands);
      
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
    } catch (error: any) {
      console.error("Failed to complete tasks:", error);
      return {
        success: false,
        error: "Failed to complete tasks. Please try again.",
        code: "BATCH_COMPLETE_FAILED",
      };
    }
  },
});