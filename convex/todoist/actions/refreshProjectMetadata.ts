import { v } from "convex/values";

import { internal } from "../../_generated/api";
import { authedAction } from "../../_lib/authed";

import type { ActionResponse } from "./utils/todoistClient";

type RefreshResult = {
  processedProjects: number;
  metadataTasksFound: number;
};

export const refreshProjectMetadata = authedAction({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ActionResponse<RefreshResult>> => {
    try {
      // Run the extraction
      const result = await ctx.runMutation(
        internal.todoist.computed.mutations.extractProjectMetadata.extractProjectMetadata,
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