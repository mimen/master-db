import type { PersonalProject, WorkspaceProject, UpdateProjectArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const updateProject = action({
  args: {
    projectId: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    isFavorite: v.optional(v.boolean()),
    viewStyle: v.optional(v.union(v.literal("list"), v.literal("board"), v.literal("calendar"))),
  },
  handler: async (ctx, { projectId, ...updateArgs }): Promise<ActionResponse<PersonalProject | WorkspaceProject>> => {
    try {
      const client = getTodoistClient();

      // Build UpdateProjectArgs for the SDK
      const projectArgs: UpdateProjectArgs = {
        name: updateArgs.name,
        color: updateArgs.color,
        isFavorite: updateArgs.isFavorite,
        viewStyle: updateArgs.viewStyle,
      };

      // Update project using SDK
      const project = await client.updateProject(projectId, projectArgs);

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
      console.error("Failed to update project:", error);
      return {
        success: false,
        error: "Failed to update project. Please try again.",
        code: "UPDATE_PROJECT_FAILED",
      };
    }
  },
});