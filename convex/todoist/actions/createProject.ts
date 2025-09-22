import type { PersonalProject, WorkspaceProject, AddProjectArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const createProject = action({
  args: {
    name: v.string(),
    parentId: v.optional(v.string()),
    color: v.optional(v.string()),
    isFavorite: v.optional(v.boolean()),
    viewStyle: v.optional(v.union(v.literal("list"), v.literal("board"), v.literal("calendar"))),
  },
  handler: async (ctx, args): Promise<ActionResponse<PersonalProject | WorkspaceProject>> => {
    try {
      const client = getTodoistClient();

      // Build AddProjectArgs for the SDK
      const projectArgs: AddProjectArgs = {
        name: args.name,
        parentId: args.parentId,
        color: args.color,
        isFavorite: args.isFavorite,
        viewStyle: args.viewStyle,
      };

      // Create project using SDK
      const project = await client.addProject(projectArgs);

      // Store in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertProject, {
        project: {
          id: project.id,
          name: project.name,
          color: project.color,
          parent_id: 'parentId' in project ? project.parentId || null : null,
          child_order: project.childOrder || 0,
          is_deleted: 0,
          is_archived: project.isArchived ? 1 : 0,
          is_favorite: project.isFavorite ? 1 : 0,
          view_style: project.viewStyle || "list",
        },
      });

      return { success: true, data: project };
    } catch (error) {
      console.error("Failed to create project:", error);
      return {
        success: false,
        error: "Failed to create project. Please try again.",
        code: "CREATE_PROJECT_FAILED",
      };
    }
  },
});