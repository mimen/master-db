import type { PersonalProject, WorkspaceProject } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Archives a project in Todoist.
 * Archived projects are hidden from the active view but can be restored later.
 */
export const archiveProject = action({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, { projectId }): Promise<ActionResponse<PersonalProject | WorkspaceProject>> => {
    try {
      const client = getTodoistClient();

      // Archive project using SDK
      const project = await client.archiveProject(projectId);

      // Update in Convex using existing mutation
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

      return {
        success: true,
        data: project,
      };
    } catch (error) {
      console.error("Failed to archive project:", error);
      return {
        success: false,
        error: "Failed to archive project. Please try again.",
        code: "ARCHIVE_PROJECT_FAILED",
      };
    }
  },
});
