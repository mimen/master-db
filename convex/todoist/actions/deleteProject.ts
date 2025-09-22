import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteProject = action({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, { projectId }): Promise<ActionResponse<{ deleted: boolean }>> => {
    try {
      const client = getTodoistClient();

      // Delete project using SDK
      const deleted = await client.deleteProject(projectId);

      // Mark as deleted in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertProject, {
        project: {
          id: projectId,
          name: "", // Name is required by schema but project is deleted
          color: "charcoal",
          parent_id: null,
          child_order: 0,
          is_deleted: 1, // Mark as deleted
          is_archived: 0,
          is_favorite: 0,
          view_style: "list",
        },
      });

      return { success: true, data: { deleted } };
    } catch (error) {
      console.error("Failed to delete project:", error);
      return {
        success: false,
        error: "Failed to delete project. Please try again.",
        code: "DELETE_PROJECT_FAILED",
      };
    }
  },
});