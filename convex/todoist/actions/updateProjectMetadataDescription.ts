import type { Task } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Updates the description of a project's metadata task.
 * This updates the actual Todoist task and then extracts the metadata back to Convex.
 */
export const updateProjectMetadataDescription = action({
  args: {
    projectId: v.string(),
    description: v.string(),
  },
  handler: async (ctx, { projectId, description }): Promise<ActionResponse<Task>> => {
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

      // Update the task's description in Todoist
      const client = getTodoistClient();
      const task = await client.updateTask(taskId, { description });

      // Sync the task to Convex
      await ctx.runMutation(internal.todoist.mutations.updateItem, {
        todoistId: taskId,
        updates: {
          description: task.description,
          updated_at: task.updatedAt || new Date().toISOString(),
          sync_version: Date.now(),
        },
      });

      // Extract metadata from this task to update project metadata
      await ctx.runMutation(internal.todoist.computed.index.extractProjectMetadata, {
        projectId,
      });

      return { success: true, data: task };
    } catch (error) {
      console.error("Failed to update project metadata description:", error);
      return {
        success: false,
        error: "Failed to update description. Please try again.",
        code: "UPDATE_METADATA_DESCRIPTION_FAILED",
      };
    }
  },
});
