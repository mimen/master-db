import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export const getProjectWithItemCount = authedQuery({
  args: {
    projectId: v.string(),
  },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db
      .query("todoist_projects")
      .filter((q) => q.eq(q.field("todoist_id"), projectId))
      .first();

    if (!project) return null;

    const items = await ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("project_id"), projectId))
      .collect();

    return {
      ...project,
      itemCount: items.length,
      completedCount: items.filter(i => i.checked === true).length,
      activeCount: items.filter(i => i.checked === false).length,
    };
  },
});