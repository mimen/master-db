import type { Task, UpdateTaskArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const updateTask = action({
  args: {
    todoistId: v.string(),
    content: v.optional(v.string()),
    priority: v.optional(v.number()),
    dueString: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    dueDatetime: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    deadlineDate: v.optional(v.string()),
    deadlineLang: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<Task>> => {
    try {
      const client = getTodoistClient();

      // Build UpdateTaskArgs for the SDK
      const updateArgs: UpdateTaskArgs = {};

      if (args.content !== undefined) updateArgs.content = args.content;
      if (args.priority !== undefined) updateArgs.priority = args.priority;
      if (args.labels !== undefined) updateArgs.labels = args.labels;
      if (args.description !== undefined) updateArgs.description = args.description;

      // Handle due date - must provide at most one of dueDate, dueDatetime, or dueString
      if (args.dueString !== undefined) {
        updateArgs.dueString = args.dueString;
      } else if (args.dueDatetime !== undefined) {
        Object.assign(updateArgs, { dueDatetime: args.dueDatetime });
      } else if (args.dueDate !== undefined) {
        Object.assign(updateArgs, { dueDate: args.dueDate });
      }

      // Handle deadline updates
      if (args.deadlineDate) {
        updateArgs.deadlineDate = args.deadlineDate;
        if (args.deadlineLang) {
          updateArgs.deadlineLang = args.deadlineLang;
        }
      }

      // Update task using SDK
      const task = await client.updateTask(args.todoistId, updateArgs);

      // Update in Convex with the response
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          content: task.content,
          description: task.description,
          priority: task.priority,
          labels: task.labels,
          due: task.due ? {
            date: task.due.date.split('T')[0], // Extract just the date part
            is_recurring: task.due.isRecurring,
            string: task.due.string,
            datetime: task.due.datetime || (task.due.date.includes('T') ? task.due.date : undefined),
            timezone: task.due.timezone,
          } : null,
          deadline: task.deadline ? {
            date: task.deadline.date,
            lang: task.deadline.lang,
          } : null,
          updated_at: task.updatedAt || new Date().toISOString(),
          sync_version: Date.now(),
        },
      });

      return { success: true, data: task };
    } catch (error) {
      console.error("Failed to update task:", error);
      return {
        success: false,
        error: "Failed to update task. Please try again.",
        code: "UPDATE_TASK_FAILED",
      };
    }
  },
});