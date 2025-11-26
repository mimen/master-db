import type { Task } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Updates the project type by modifying labels on the project's metadata task.
 *
 * Project types are determined by labels on the metadata task:
 * - "area-of-responsibility" label = Area (ongoing responsibility)
 * - "project-type" label = Project (finite work)
 * - No type label = Unassigned
 *
 * This action ensures only one type label exists at a time.
 */
export const updateProjectType = action({
  args: {
    projectId: v.string(),
    projectType: v.union(
      v.literal("area-of-responsibility"),
      v.literal("project-type"),
      v.null()
    ),
  },
  handler: async (ctx, { projectId, projectType }): Promise<ActionResponse<Task>> => {
    try {
      // Get metadata to find source_task_id
      const metadata = await ctx.runQuery(
        api.todoist.queries.getProjectMetadata.getProjectMetadata,
        { projectId }
      );

      let taskId = metadata?.source_task_id;

      // If no metadata task exists, create it first
      if (!taskId) {
        const ensureResult = await ctx.runAction(
          api.todoist.actions.ensureProjectMetadataTask.ensureProjectMetadataTask,
          { projectId }
        );

        if (!ensureResult.success || !ensureResult.data) {
          return {
            success: false,
            error: "Failed to create metadata task.",
            code: "METADATA_TASK_CREATION_FAILED",
          };
        }

        taskId = ensureResult.data.taskId;
      }

      // Get the current task to read existing labels
      const client = getTodoistClient();
      let currentTask: Task;

      try {
        currentTask = await client.getTask(taskId);
      } catch (error) {
        // Task might have been deleted - recreate it and try again
        console.warn("Metadata task not found, recreating:", error);

        const ensureResult = await ctx.runAction(
          api.todoist.actions.ensureProjectMetadataTask.ensureProjectMetadataTask,
          { projectId }
        );

        if (!ensureResult.success || !ensureResult.data) {
          return {
            success: false,
            error: "Failed to recreate metadata task.",
            code: "METADATA_TASK_RECREATION_FAILED",
          };
        }

        taskId = ensureResult.data.taskId;
        currentTask = await client.getTask(taskId);
      }

      // Build new labels array
      // Remove both type labels, then add the selected one (if not null)
      const otherLabels = currentTask.labels.filter(
        label => label !== "area-of-responsibility" && label !== "project-type"
      );

      const newLabels = projectType
        ? [...otherLabels, projectType]
        : otherLabels;

      // Update the task's labels in Todoist
      let task: Task;

      try {
        task = await client.updateTask(taskId, { labels: newLabels });
      } catch (updateError) {
        console.error("Failed to update task labels:", updateError);
        return {
          success: false,
          error: "Failed to update project type. Please try again.",
          code: "UPDATE_LABELS_FAILED",
        };
      }

      // Sync the task to Convex
      await ctx.runMutation(internal.todoist.internalMutations.updateItem.updateItem, {
        todoistId: taskId,
        updates: {
          labels: task.labels,
          updated_at: task.updatedAt || new Date().toISOString(),
          sync_version: Date.now(),
        },
      });

      // Extract metadata from this task to update project metadata (including project_type)
      await ctx.runMutation(internal.todoist.computed.mutations.extractProjectMetadata.extractProjectMetadata, {
        projectId,
      });

      return { success: true, data: task };
    } catch (error) {
      console.error("Failed to update project type:", error);
      return {
        success: false,
        error: "Failed to update project type. Please try again.",
        code: "UPDATE_PROJECT_TYPE_FAILED",
      };
    }
  },
});
