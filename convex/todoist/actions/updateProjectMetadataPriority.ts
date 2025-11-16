import type { Task } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Updates the priority of a project's metadata task.
 * This updates the actual Todoist task and then extracts the metadata back to Convex.
 */
export const updateProjectMetadataPriority = action({
  args: {
    projectId: v.string(),
    priority: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
  },
  handler: async (ctx, { projectId, priority }): Promise<ActionResponse<Task>> => {
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

      // Update the task's priority in Todoist
      const client = getTodoistClient();
      let task: Task;

      try {
        task = await client.updateTask(taskId, { priority });
      } catch (updateError) {
        // Task might have been deleted - recreate it and try again
        console.warn("Metadata task not found, recreating:", updateError);

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
        task = await client.updateTask(taskId, { priority });
      }

      // Sync the task to Convex
      await ctx.runMutation(internal.todoist.internalMutations.updateItem.updateItem, {
        todoistId: taskId,
        updates: {
          priority: task.priority,
          updated_at: task.updatedAt || new Date().toISOString(),
          sync_version: Date.now(),
        },
      });

      // Extract metadata from this task to update project metadata
      await ctx.runMutation(internal.todoist.computed.mutations.extractProjectMetadata.extractProjectMetadata, {
        projectId,
      });

      return { success: true, data: task };
    } catch (error) {
      console.error("Failed to update project metadata priority:", error);
      return {
        success: false,
        error: "Failed to update priority. Please try again.",
        code: "UPDATE_METADATA_PRIORITY_FAILED",
      };
    }
  },
});
