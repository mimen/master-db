import type { Task, MoveTaskArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const moveTask = action({
  args: {
    todoistId: v.string(),
    projectId: v.optional(v.string()),
    sectionId: v.optional(v.string()),
    parentId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<Task[]>> => {
    try {
      const client = getTodoistClient();

      // Build move args for SDK - must provide exactly one destination
      let moveArgs: MoveTaskArgs;

      if (args.sectionId) {
        moveArgs = { sectionId: args.sectionId };
      } else if (args.parentId) {
        moveArgs = { parentId: args.parentId };
      } else if (args.projectId) {
        moveArgs = { projectId: args.projectId };
      } else {
        throw new Error("Must provide either projectId, sectionId, or parentId");
      }

      // Move task using SDK
      const tasks = await client.moveTasks([args.todoistId], moveArgs);

      if (tasks && tasks.length > 0) {
        const task = tasks[0];

        // Update in Convex
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates: {
            project_id: task.projectId,
            section_id: task.sectionId,
            parent_id: task.parentId || null,
            updated_at: task.updatedAt || new Date().toISOString(),
            sync_version: Date.now(),
          },
        });
      }

      return { success: true, data: tasks };
    } catch (error) {
      console.error("Failed to move task:", error);
      return {
        success: false,
        error: "Failed to move task. Please try again.",
        code: "MOVE_TASK_FAILED",
      };
    }
  },
});