import { randomUUID } from "crypto";

import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const updateTask = action({
  args: {
    todoistId: v.string(),
    content: v.optional(v.string()),
    priority: v.optional(v.number()),
    due: v.optional(v.object({
      date: v.string(),
      string: v.optional(v.string()),
      datetime: v.optional(v.string()),
      timezone: v.optional(v.string()),
    })),
    labels: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<any>> => {
    try {
      const client = getTodoistClient();
      const commandId = randomUUID();
      
      // Build update args
      const updateArgs: any = {
        id: args.todoistId,
      };
      if (args.content !== undefined) updateArgs.content = args.content;
      if (args.priority !== undefined) updateArgs.priority = args.priority;
      if (args.labels !== undefined) updateArgs.labels = args.labels;
      if (args.description !== undefined) updateArgs.description = args.description;
      if (args.due) {
        if (args.due.string) updateArgs.due_string = args.due.string;
        else if (args.due.datetime) updateArgs.due_datetime = args.due.datetime;
        else if (args.due.date) updateArgs.due_date = args.due.date;
      }

      // Execute command via Sync API v1
      await client.executeCommands([{
        type: "item_update",
        uuid: commandId,
        args: updateArgs,
      }]);

      // Update in Convex - remove the id field from updates
      const { id: _id, ...updateFields } = updateArgs;
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          ...updateFields,
          sync_version: Date.now(),
        },
      });

      return { success: true, data: updateArgs };
    } catch (error: any) {
      console.error("Failed to update task:", error);
      return {
        success: false,
        error: "Failed to update task. Please try again.",
        code: "UPDATE_TASK_FAILED",
      };
    }
  },
});