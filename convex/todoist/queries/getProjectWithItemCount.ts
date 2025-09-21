import { v } from "convex/values";

import { query } from "../../_generated/server";

export const getProjectWithItemCount = query({
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
      completedCount: items.filter(i => i.checked === 1).length,
      activeCount: items.filter(i => i.checked === 0).length,
    };
  },
});