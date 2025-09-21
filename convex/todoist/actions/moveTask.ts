import { randomUUID } from "crypto";

import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const moveTask = action({
  args: {
    todoistId: v.string(),
    projectId: v.string(),
    sectionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<any>> => {
    try {
      const client = getTodoistClient();
      const commandId = randomUUID();

      // Execute command via API v1
      const response = await client.executeCommands([{
        type: "item_move",
        uuid: commandId,
        args: {
          id: args.todoistId,
          project_id: args.projectId,
          section_id: args.sectionId,
        },
      }]);

      // Update in Convex - don't set section_id if not provided
      const updates: any = {
        project_id: args.projectId,
        sync_version: Date.now(),
      };

      if (args.sectionId) {
        updates.section_id = args.sectionId;
      }

      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates,
      });

      return { success: true, data: response };
    } catch (error: any) {
      console.error("Failed to move task:", error);
      return {
        success: false,
        error: "Failed to move task. Please try again.",
        code: "MOVE_TASK_FAILED",
      };
    }
  },
});