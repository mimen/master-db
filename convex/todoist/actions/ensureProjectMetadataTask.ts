import type { Task } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Ensures a project has a metadata task in Todoist.
 * Creates the task if it doesn't exist, returns existing task ID if it does.
 * The metadata task is a special task with the "project-metadata" label.
 */
export const ensureProjectMetadataTask = action({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, { projectId }): Promise<ActionResponse<{
    taskId: string;
    created: boolean;
    task?: Task;
  }>> => {
    try {
      // Check if metadata already exists with source_task_id
      const metadata = await ctx.runQuery(
        api.todoist.queries.getProjectMetadata.getProjectMetadata,
        { projectId }
      );

      if (metadata?.source_task_id) {
        // Verify the task actually exists in Todoist
        const client = getTodoistClient();
        try {
          await client.getTask(metadata.source_task_id);
          // Task exists in Todoist - we're good!
          return {
            success: true,
            data: {
              taskId: metadata.source_task_id,
              created: false,
            },
          };
        } catch (error) {
          // Task was deleted in Todoist - need to create a new one
          console.warn("Metadata task was deleted, creating new one:", error);
          // Fall through to create new task - extractProjectMetadata will update the record
        }
      }

      // Need to create the metadata task
      const client = getTodoistClient();

      // Get the project to use its name
      const project = await ctx.runQuery(
        api.todoist.queries.getProjects.getProjectByTodoistId,
        { todoistId: projectId }
      );

      if (!project) {
        return {
          success: false,
          error: "Project not found",
          code: "PROJECT_NOT_FOUND",
        };
      }

      // Create task with project name as content
      const task = await client.addTask({
        content: project.name,  // Use project name as task content
        projectId,
        labels: ["project-metadata"],
        priority: 1,  // Default to P4 (normal)
      });

      // Sync the task to Convex
      await ctx.runMutation(internal.todoist.mutations.upsertItem, {
        item: {
          id: task.id,
          content: task.content,
          description: task.description,
          project_id: task.projectId,
          section_id: task.sectionId || null,
          parent_id: task.parentId || null,
          child_order: task.childOrder,
          priority: task.priority,
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

      // Extract metadata from this task
      await ctx.runMutation(internal.todoist.computed.index.extractProjectMetadata, {
        projectId,
      });

      return {
        success: true,
        data: {
          taskId: task.id,
          created: true,
          task,
        },
      };
    } catch (error) {
      console.error("Failed to ensure project metadata task:", error);
      return {
        success: false,
        error: "Failed to create project metadata task. Please try again.",
        code: "ENSURE_METADATA_TASK_FAILED",
      };
    }
  },
});
