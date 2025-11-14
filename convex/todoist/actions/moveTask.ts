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

    // Store original values for rollback
    const existing = await ctx.runQuery(
      internal.todoist.queries.getItemByTodoistId.getItemByTodoistId,
      {
        todoistId: args.todoistId
      }
    );

    // Build optimistic update
    const optimisticUpdates: Record<string, string | number | null> = {
      updated_at: new Date().toISOString(),
      sync_version: Date.now(),
    };

    if (args.projectId) {
      optimisticUpdates.project_id = args.projectId;
    }
    if (args.sectionId) {
      optimisticUpdates.section_id = args.sectionId;
    }
    if (args.parentId) {
      optimisticUpdates.parent_id = args.parentId;
    }

    // STEP 1: OPTIMISTIC UPDATE - Update Convex immediately
    await ctx.runMutation(internal.todoist.mutations.updateItem, {
      todoistId: args.todoistId,
      updates: optimisticUpdates,
    });

    try {
      const client = getTodoistClient();

      // STEP 2: REAL UPDATE - Send to Todoist API
      const tasks = await client.moveTasks([args.todoistId], moveArgs);

      if (tasks && tasks.length > 0) {
        const task = tasks[0];

        // STEP 3: SYNC - Update with real API response
        const updates: Record<string, string | number | null> = {
          project_id: task.projectId,
          updated_at: task.updatedAt || new Date().toISOString(),
          sync_version: Date.now(),
        };

        if (task.sectionId !== null && task.sectionId !== undefined) {
          updates.section_id = task.sectionId;
        }

        if (task.parentId !== null && task.parentId !== undefined) {
          updates.parent_id = task.parentId;
        }

        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates,
        });
      }

      return { success: true, data: tasks };
    } catch (error) {
      // STEP 4: ROLLBACK - Restore original values on error
      if (existing) {
        const rollbackUpdates: Record<string, string | number | null> = {
          sync_version: Date.now(),
        };

        if (existing.project_id !== undefined) {
          rollbackUpdates.project_id = existing.project_id;
        }

        if (existing.updated_at !== undefined) {
          rollbackUpdates.updated_at = existing.updated_at;
        }

        if (existing.section_id !== undefined) {
          rollbackUpdates.section_id = existing.section_id;
        }

        if (existing.parent_id !== undefined) {
          rollbackUpdates.parent_id = existing.parent_id;
        }

        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates: rollbackUpdates,
        });
      }

      console.error("Failed to move task:", error);
      return {
        success: false,
        error: "Failed to move task. Please try again.",
        code: "MOVE_TASK_FAILED",
      };
    }
  },
});