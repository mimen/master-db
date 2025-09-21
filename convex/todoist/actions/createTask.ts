import { randomUUID } from "crypto";

import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const createTask = action({
  args: {
    content: v.string(),
    projectId: v.optional(v.string()),
    sectionId: v.optional(v.string()),
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
      const tempId = randomUUID();
      const commandId = randomUUID();
      
      // Build command args
      const commandArgs: any = {
        content: args.content,
        priority: args.priority || 1,
      };

      if (args.projectId) commandArgs.project_id = args.projectId;
      if (args.sectionId) commandArgs.section_id = args.sectionId;
      if (args.labels?.length) commandArgs.labels = args.labels;
      if (args.description) commandArgs.description = args.description;
      if (args.due) {
        if (args.due.string) commandArgs.due_string = args.due.string;
        else if (args.due.datetime) commandArgs.due_datetime = args.due.datetime;
        else if (args.due.date) commandArgs.due_date = args.due.date;
      }

      // Execute command via Sync API v1
      const response = await client.executeCommands([{
        type: "item_add",
        temp_id: tempId,
        uuid: commandId,
        args: commandArgs,
      }]);

      // Get the real ID from temp_id_mapping
      const realId = response.temp_id_mapping?.[tempId];
      if (!realId) {
        throw new Error("Failed to get task ID from response");
      }

      // Store in Convex - we'll get full details from next sync
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: {
          id: realId,
          content: args.content,
          project_id: args.projectId,
          section_id: args.sectionId,
          priority: args.priority || 1,
          labels: args.labels || [],
          description: args.description,
          checked: 0,
          is_deleted: 0,
          child_order: 0,
          comment_count: 0,
          added_at: new Date().toISOString(),
          user_id: "current",
          sync_version: Date.now(),
        },
      });

      return { success: true, data: { id: realId, ...commandArgs } };
    } catch (error: any) {
      console.error("Failed to create task:", error);
      return {
        success: false,
        error: "Failed to create task. Please try again.",
        code: "CREATE_TASK_FAILED",
      };
    }
  },
});