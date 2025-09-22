import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";

import type { ActionResponse } from "./utils/todoistClient";

type RefreshResult = {
  processedProjects: number;
  metadataTasksFound: number;
};

export const refreshProjectMetadata = action({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<RefreshResult>> => {
    try {
      // Run the extraction
      const result = await ctx.runMutation(
        internal.todoist.mutations.computed.extractProjectMetadata,
        { projectId: args.projectId }
      );

      return {
        success: true,
        data: result as RefreshResult,
      };
    } catch (error) {
      console.error("Failed to refresh project metadata:", error);
      return {
        success: false,
        error: "Failed to refresh project metadata",
        code: "METADATA_REFRESH_FAILED",
      };
    }
  },
});