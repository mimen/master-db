import type { PersonalProject, WorkspaceProject } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Updates a project's name in Todoist and syncs to Convex.
 * This is a focused action for the Projects view name editing feature.
 */
export const updateProjectName = action({
  args: {
    projectId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { projectId, name }): Promise<ActionResponse<PersonalProject | WorkspaceProject>> => {
    try {
      const client = getTodoistClient();

      // Update project name using SDK
      const project = await client.updateProject(projectId, { name });

      // Store in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertProject, {
        project: {
          id: project.id,
          name: project.name,
          color: project.color,
          parent_id: 'parentId' in project ? project.parentId || null : null,
          child_order: project.childOrder || 0,
          is_deleted: false,
          is_archived: Boolean(project.isArchived),
          is_favorite: Boolean(project.isFavorite),
          view_style: project.viewStyle || "list",
        },
      });

      return { success: true, data: project };
    } catch (error) {
      console.error("Failed to update project name:", error);
      return {
        success: false,
        error: "Failed to update project name. Please try again.",
        code: "UPDATE_PROJECT_NAME_FAILED",
      };
    }
  },
});
