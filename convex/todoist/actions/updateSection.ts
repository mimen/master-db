import type { Section, UpdateSectionArgs } from "@doist/todoist-api-typescript";
import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const updateSection = action({
  args: {
    sectionId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { sectionId, name }): Promise<ActionResponse<Section>> => {
    try {
      const client = getTodoistClient();

      // Build UpdateSectionArgs for the SDK
      const sectionArgs: UpdateSectionArgs = {
        name,
      };

      // Update section using SDK
      const section = await client.updateSection(sectionId, sectionArgs);

      // Store in Convex using existing mutation
      await ctx.runMutation(internal.todoist.mutations.upsertSection, {
        section: {
          id: section.id,
          name: section.name,
          project_id: section.projectId,
          section_order: section.sectionOrder || 0,
          is_deleted: false,
          is_archived: false,
        },
      });

      return { success: true, data: section };
    } catch (error) {
      console.error("Failed to update section:", error);
      return {
        success: false,
        error: "Failed to update section. Please try again.",
        code: "UPDATE_SECTION_FAILED",
      };
    }
  },
});