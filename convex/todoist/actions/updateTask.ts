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
    deadlineDate: v.optional(v.union(v.string(), v.null())),
    deadlineLang: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<ActionResponse<Task>> => {
    // Build optimistic update object
    const optimisticUpdates: Record<string, any> = {
      updated_at: new Date().toISOString(),
      sync_version: Date.now(),
    };

    if (args.content !== undefined) optimisticUpdates.content = args.content;
    if (args.priority !== undefined) optimisticUpdates.priority = args.priority;
    if (args.labels !== undefined) optimisticUpdates.labels = args.labels;
    if (args.description !== undefined) optimisticUpdates.description = args.description;

    // Handle due date for optimistic update
    if (args.dueString !== undefined || args.dueDate !== undefined || args.dueDatetime !== undefined) {
      // For optimistic update, we'll set a placeholder - real sync will fix it
      optimisticUpdates.due = args.dueString
        ? { date: new Date().toISOString().split('T')[0], string: args.dueString }
        : args.dueDate
        ? { date: args.dueDate }
        : args.dueDatetime
        ? { date: args.dueDatetime.split('T')[0], datetime: args.dueDatetime }
        : null;
    }

    // Handle deadline for optimistic update
    if (args.deadlineDate !== undefined) {
      optimisticUpdates.deadline = args.deadlineDate
        ? { date: args.deadlineDate, lang: args.deadlineLang || 'en' }
        : null;
    }

    // Store original values for rollback
    const existing = await ctx.runQuery(
      internal.todoist.queries.getItemByTodoistId,
      {
        todoistId: args.todoistId
      }
    );

    // STEP 1: OPTIMISTIC UPDATE - Update Convex immediately
    await ctx.runMutation(internal.todoist.mutations.updateItem, {
      todoistId: args.todoistId,
      updates: optimisticUpdates,
    });

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
      if (args.deadlineDate !== undefined) {
        updateArgs.deadlineDate = args.deadlineDate;
        if (args.deadlineLang !== undefined) {
          updateArgs.deadlineLang = args.deadlineLang;
        }
      }

      // STEP 2: REAL UPDATE - Send to Todoist API
      const task = await client.updateTask(args.todoistId, updateArgs);

      // STEP 3: SYNC - Update with real API response
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: args.todoistId,
        updates: {
          content: task.content,
          description: task.description,
          priority: task.priority,
          labels: task.labels,
          due: task.due ? {
            date: task.due.date.split('T')[0],
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
      // STEP 4: ROLLBACK - Restore original values on error
      if (existing) {
        await ctx.runMutation(internal.todoist.mutations.updateItem, {
          todoistId: args.todoistId,
          updates: {
            content: existing.content,
            description: existing.description,
            priority: existing.priority,
            labels: existing.labels,
            due: existing.due,
            deadline: existing.deadline,
            updated_at: existing.updated_at,
            sync_version: Date.now(),
          },
        });
      }

      console.error("Failed to update task:", error);
      return {
        success: false,
        error: "Failed to update task. Please try again.",
        code: "UPDATE_TASK_FAILED",
      };
    }
  },
});