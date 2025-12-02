import type { Task, AddTaskArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { ActionResponse, getTodoistClient } from "../../todoist/actions/utils/todoistClient";
import { durationToMinutes } from "../types/duration";
import { getTimeOfDayLabel } from "../types/timeOfDay";

/**
 * Creates a Todoist task for a specific routineTask
 * Links the created task back to the routineTask record
 */
export const createRoutineTaskInTodoist = internalAction({
  args: {
    routineTaskId: v.id("routineTasks"),
  },
  handler: async (ctx, { routineTaskId }): Promise<ActionResponse<Task>> => {
    try {
      // Get the routineTask and routine via direct DB access
      // Note: We need to use scheduler.runAfter or implement as internalAction
      // For now, we'll fetch directly in the action
      const routineTask = await ctx.runQuery(
        internal.routines.internalQueries.getRoutineTask.getRoutineTask,
        { routineTaskId }
      );

      if (!routineTask) {
        return {
          success: false,
          error: "RoutineTask not found",
          code: "ROUTINE_TASK_NOT_FOUND",
        };
      }

      // Get the routine
      const routine = await ctx.runQuery(internal.routines.internalQueries.getRoutine.getRoutine, {
        routineId: routineTask.routineId,
      });

      if (!routine) {
        return {
          success: false,
          error: "Routine not found",
          code: "ROUTINE_NOT_FOUND",
        };
      }

      const client = getTodoistClient();

      // Format dates - readyDate becomes scheduled date, dueDate becomes deadline
      const scheduledDate = new Date(routineTask.readyDate);
      const deadlineDate = new Date(routineTask.dueDate);

      // Prepare labels - add "routine" and time-of-day label
      const labels = [...(routine.todoistLabels || []), "routine"];
      if (routine.timeOfDay) {
        labels.push(getTimeOfDayLabel(routine.timeOfDay));
      }

      // Build task args - following the same pattern as createTask.ts
      const taskArgs: AddTaskArgs = {
        content: routine.name,
        labels,
      };

      // Add description if present
      if (routine.description) {
        taskArgs.description = routine.description;
      }

      // Set scheduled date (shows in Today/Upcoming)
      const scheduledDateStr = scheduledDate.toISOString().split("T")[0];
      Object.assign(taskArgs, { dueDate: scheduledDateStr });

      // Set deadline only if different from scheduled (skip for daily routines)
      const deadlineDateStr = deadlineDate.toISOString().split("T")[0];
      if (deadlineDateStr !== scheduledDateStr) {
        taskArgs.deadlineDate = deadlineDateStr;
      }

      // Set priority if specified
      if (routine.priority) {
        taskArgs.priority = routine.priority;
      }

      // Set project - use Routines Inbox as default if no project specified
      taskArgs.projectId = routine.todoistProjectId || "6fH56rR7WJ74jQFX";

      // Set duration if specified
      if (routine.duration) {
        taskArgs.duration = durationToMinutes(routine.duration);
        taskArgs.durationUnit = "minute";
      }

      // Create task in Todoist
      const task = await client.addTask(taskArgs);

      // Sync to Convex via upsertItem
      await ctx.runMutation(internal.todoist.internalMutations.upsertItem.upsertItem, {
        item: {
          id: task.id,
          content: task.content,
          description: task.description,
          project_id: task.projectId,
          section_id: task.sectionId || null,
          parent_id: task.parentId || null,
          child_order: task.childOrder,
          priority: task.priority,
          due: task.due
            ? {
                date: task.due.date.split("T")[0],
                is_recurring: task.due.isRecurring,
                string: task.due.string,
                datetime:
                  task.due.datetime ||
                  (task.due.date.includes("T") ? task.due.date : undefined),
                timezone: task.due.timezone,
              }
            : null,
          deadline: task.deadline
            ? {
                date: task.deadline.date,
                lang: task.deadline.lang,
              }
            : null,
          labels: task.labels,
          assigned_by_uid: task.assignedByUid || null,
          added_by_uid: task.addedByUid,
          comment_count: task.noteCount || 0,
          checked: Boolean(task.checked),
          is_deleted: Boolean(task.isDeleted),
          added_at: task.addedAt || new Date().toISOString(),
          completed_at: task.completedAt || null,
          updated_at: task.updatedAt || new Date().toISOString(),
          user_id: "",
        },
      });

      // Link the routineTask to the Todoist task
      await ctx.runMutation(internal.routines.internalMutations.linkRoutineTask.linkRoutineTask, {
        routineTaskId,
        todoistTaskId: task.id,
      });

      return { success: true, data: task };
    } catch (error) {
      console.error("Failed to create routine task in Todoist:", error);
      return {
        success: false,
        error: "Failed to create routine task. Please try again.",
        code: "CREATE_ROUTINE_TASK_FAILED",
      };
    }
  },
});
