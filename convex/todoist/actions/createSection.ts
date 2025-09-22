import type { Section, AddSectionArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const createSection = action({
  args: {
    name: v.string(),
    projectId: v.string(),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ActionResponse<Section>> => {
    try {
      const client = getTodoistClient();

      // Build AddSectionArgs for the SDK
      const sectionArgs: AddSectionArgs = {
        name: args.name,
        projectId: args.projectId,
        order: args.order,
      };

      // Create section using SDK
      const section = await client.addSection(sectionArgs);

      // Store in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertSection, {
        section: {
          id: section.id,
          name: section.name,
          project_id: section.projectId,
          section_order: section.order || 0,
          is_deleted: 0,
          is_archived: 0,
        },
      });

      return { success: true, data: section };
    } catch (error) {
      console.error("Failed to create section:", error);
      return {
        success: false,
        error: "Failed to create section. Please try again.",
        code: "CREATE_SECTION_FAILED",
      };
    }
  },
});