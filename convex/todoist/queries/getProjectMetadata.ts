import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export const getProjectMetadata = authedQuery({
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