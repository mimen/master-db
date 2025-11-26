import type { PersonalProject, WorkspaceProject } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Unarchives a project in Todoist.
 * Restores an archived project back to the active view.
 */
export const unarchiveProject = action({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, { projectId }): Promise<ActionResponse<PersonalProject | WorkspaceProject>> => {
    try {
      const client = getTodoistClient();

      // Unarchive project using SDK
      const project = await client.unarchiveProject(projectId);

      // Update in Convex using existing mutation
      await ctx.runMutation(internal.todoist.internalMutations.upsertProject.upsertProject, {
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

      return {
        success: true,
        data: project,
      };
    } catch (error) {
      console.error("Failed to unarchive project:", error);
      return {
        success: false,
        error: "Failed to unarchive project. Please try again.",
        code: "UNARCHIVE_PROJECT_FAILED",
      };
    }
  },
});
