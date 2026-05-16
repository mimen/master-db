import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export const getProject = authedQuery({
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