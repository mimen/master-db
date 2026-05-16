import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

export const resetProjectMetadata = internalMutation({
  args: {
    metadataId: v.id("todoist_project_metadata"),
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    // Replace the entire document with minimal data
    await ctx.db.replace(args.metadataId, {
      project_id: args.projectId,
      last_updated: Date.now(),
      sync_version: Date.now(),
    });
  },
});