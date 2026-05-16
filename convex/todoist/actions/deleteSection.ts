import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { authedAction } from "../../_lib/authed";

import { ActionResponse, getTodoistClient } from "./utils/todoistClient";

export const deleteSection = authedAction({
  args: {
    sectionId: v.string(),
  },
  handler: async (ctx, { sectionId }): Promise<ActionResponse<{ deleted: boolean }>> => {
    try {
      const client = getTodoistClient();

      // Delete section using SDK
      const deleted = await client.deleteSection(sectionId);

      // Mark as deleted in Convex using existing mutation
      await ctx.runMutation(internal.todoist.internalMutations.upsertSection.upsertSection, {
        section: {
          id: sectionId,
          name: "", // Name is required by schema but section is deleted
          project_id: "", // Project ID is required by schema but section is deleted
          section_order: 0,
          is_deleted: true, // Mark as deleted
          is_archived: false,
        },
      });

      return { success: true, data: { deleted } };
    } catch (error) {
      console.error("Failed to delete section:", error);
      return {
        success: false,
        error: "Failed to delete section. Please try again.",
        code: "DELETE_SECTION_FAILED",
      };
    }
  },
});