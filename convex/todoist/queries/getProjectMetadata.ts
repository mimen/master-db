import { v } from "convex/values";

import { query } from "../../_generated/server";

export const getProjectMetadata = query({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("todoist_project_metadata")
      .withIndex("by_project", q => q.eq("project_id", args.projectId))
      .first();
  },
});