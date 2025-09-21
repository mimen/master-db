import type { Task, AddTaskArgs } from "@doist/todoist-api-typescript";
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
  handler: async (ctx, args): Promise<ActionResponse<Task>> => {
    try {
      const client = getTodoistClient();

      // Build AddTaskArgs for the SDK
      const taskArgs: AddTaskArgs = {
        content: args.content,
        priority: args.priority,
        projectId: args.projectId,
        sectionId: args.sectionId,
        labels: args.labels,
        description: args.description,
      };

      // Handle due date - must provide at most one of dueDate or dueDatetime
      if (args.due) {
        if (args.due.string) {
          taskArgs.dueString = args.due.string;
        } else if (args.due.datetime) {
          // Use spread to create new object with only dueDatetime
          Object.assign(taskArgs, { dueDatetime: args.due.datetime });
        } else if (args.due.date) {
          // Use spread to create new object with only dueDate
          Object.assign(taskArgs, { dueDate: args.due.date });
        }
      }

      // Create task using SDK
      const task = await client.addTask(taskArgs);

      // Store in Convex
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: {
          id: task.id,
          content: task.content,
          description: task.description,
          project_id: task.projectId,
          section_id: task.sectionId,
          parent_id: task.parentId,
          child_order: task.childOrder,
          priority: task.priority,
          due: task.due ? {
            date: task.due.date,
            is_recurring: task.due.isRecurring,
            string: task.due.string,
            datetime: task.due.datetime,
            timezone: task.due.timezone,
          } : null,
          labels: task.labels,
          assignee_id: task.responsibleUid,
          assigner_id: task.assignedByUid,
          comment_count: task.noteCount,
          checked: task.checked ? 1 : 0,
          is_deleted: task.isDeleted ? 1 : 0,
          added_at: task.addedAt || new Date().toISOString(),
          added_by_uid: task.addedByUid,
          completed_at: task.completedAt,
          updated_at: task.updatedAt || new Date().toISOString(),
          sync_version: Date.now(),
        },
      });

      return { success: true, data: task };
    } catch (error) {
      console.error("Failed to create task:", error);
      return {
        success: false,
        error: "Failed to create task. Please try again.",
        code: "CREATE_TASK_FAILED",
      };
    }
  },
});