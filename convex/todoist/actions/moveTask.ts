import type { Task, MoveTaskArgs } from "@doist/todoist-api-typescript";
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
  handler: async (ctx, args): Promise<ActionResponse<Task[]>> => {
    try {
      const client = getTodoistClient();

      // Build move args for SDK
      const moveArgs: MoveTaskArgs = {
        projectId: args.projectId,
      };

      if (args.sectionId) {
        moveArgs.sectionId = args.sectionId;
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