import type { Task, AddTaskArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const duplicateTask = action({
  args: {
    taskId: v.string(),
    options: v.optional(v.object({
      newContent: v.optional(v.string()),
      projectId: v.optional(v.string()),
      sectionId: v.optional(v.string()),
      parentId: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<ActionResponse<Task>> => {
    try {
      const client = getTodoistClient();

      // First, get the original task from the SDK
      const originalTask = await client.getTask(args.taskId);

      // Build the new task args by copying from original
      const newTaskArgs: AddTaskArgs = {
        content: args.options?.newContent || originalTask.content + " (copy)",
        projectId: args.options?.projectId || originalTask.projectId,
        priority: originalTask.priority,
        labels: originalTask.labels,
        description: originalTask.description,
      };

      // Only add sectionId if it's not null
      if (args.options?.sectionId !== undefined) {
        newTaskArgs.sectionId = args.options.sectionId || undefined;
      } else if (originalTask.sectionId) {
        newTaskArgs.sectionId = originalTask.sectionId;
      }

      // Only add parentId if it's not null
      if (args.options?.parentId !== undefined) {
        newTaskArgs.parentId = args.options.parentId || undefined;
      } else if (originalTask.parentId) {
        newTaskArgs.parentId = originalTask.parentId;
      }

      // Handle due date if present
      if (originalTask.due) {
        // Use dueString to preserve the original due date format
        Object.assign(newTaskArgs, { dueString: originalTask.due.string });
      }

      // Create the duplicated task
      const duplicatedTask = await client.addTask(newTaskArgs);

      // Store in Convex
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: {
          id: duplicatedTask.id,
          content: duplicatedTask.content,
          description: duplicatedTask.description,
          project_id: duplicatedTask.projectId,
          section_id: duplicatedTask.sectionId || null,
          parent_id: duplicatedTask.parentId || null,
          child_order: duplicatedTask.childOrder,
          priority: duplicatedTask.priority,
          due: duplicatedTask.due ? {
            date: duplicatedTask.due.date.split('T')[0],
            is_recurring: duplicatedTask.due.isRecurring,
            string: duplicatedTask.due.string,
            datetime: duplicatedTask.due.datetime || (duplicatedTask.due.date.includes('T') ? duplicatedTask.due.date : undefined),
            timezone: duplicatedTask.due.timezone,
          } : null,
          labels: duplicatedTask.labels,
          assigned_by_uid: duplicatedTask.assignedByUid || null,
          added_by_uid: duplicatedTask.addedByUid,
          comment_count: duplicatedTask.noteCount || 0,
          checked: Boolean(duplicatedTask.checked),
          is_deleted: Boolean(duplicatedTask.isDeleted),
          added_at: duplicatedTask.addedAt || new Date().toISOString(),
          completed_at: duplicatedTask.completedAt || null,
          updated_at: duplicatedTask.updatedAt || new Date().toISOString(),
          user_id: "", // This field is not in SDK response
        },
      });

      return { success: true, data: duplicatedTask };
    } catch (error) {
      console.error("Failed to duplicate task:", error);
      return {
        success: false,
        error: "Failed to duplicate task. Please try again.",
        code: "DUPLICATE_TASK_FAILED",
      };
    }
  },
});