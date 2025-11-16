import type { PersonalProject, WorkspaceProject } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

/**
 * Move a project to a new parent and/or update its position (child_order)
 * The API supports parent_id and child_order even though UpdateProjectArgs doesn't include them
 */
export const moveProject = action({
  args: {
    projectId: v.string(),
    parentId: v.optional(v.union(v.string(), v.null())), // null = move to root
    childOrder: v.number(),
  },
  handler: async (ctx, { projectId, parentId, childOrder }): Promise<ActionResponse<PersonalProject | WorkspaceProject>> => {
    try {
      const client = getTodoistClient();

      // Update project using SDK - cast to include parent_id and child_order
      // The API supports these fields even though TypeScript types don't show them
      const project = await client.updateProject(projectId, {
        parentId: parentId === undefined ? null : parentId,
        childOrder: childOrder,
      } as any);

      // Store in Convex using existing mutation
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

      return { success: true, data: project };
    } catch (error) {
      console.error("Failed to move project:", error);
      return {
        success: false,
        error: "Failed to move project. Please try again.",
        code: "MOVE_PROJECT_FAILED",
      };
    }
  },
});
