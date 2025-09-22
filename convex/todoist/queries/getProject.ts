import { v } from "convex/values";

import { query } from "../../_generated/server";

export const getProject = query({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("todoist_id"), projectId))
      .first();
  },
});