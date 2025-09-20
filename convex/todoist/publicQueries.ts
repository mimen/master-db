import { query } from "../_generated/server";
import { v } from "convex/values";

export const getActiveItems = query({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("todoist_items")
      .filter((q) => q.eq(q.field("checked"), 0));

    if (args.projectId) {
      q = q.filter((q) => q.eq(q.field("project_id"), args.projectId));
    }

    const items = await q.collect();
    
    // Sort by child_order
    return items.sort((a, b) => a.child_order - b.child_order);
  },
});

export const getProjects = query({
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("todoist_projects")
      .collect();
    
    return projects.sort((a, b) => a.sync_version - b.sync_version);
  },
});

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

export const getSyncStatus = query({
  handler: async (ctx) => {
    const syncState = await ctx.db
      .query("sync_state")
      .filter((q) => q.eq(q.field("service"), "todoist"))
      .first();
      
    const items = await ctx.db.query("todoist_items").collect();
    const projects = await ctx.db.query("todoist_projects").collect();
    
    return {
      lastFullSync: syncState?.last_full_sync,
      lastIncrementalSync: syncState?.last_incremental_sync,
      syncToken: syncState?.last_sync_token,
      itemCount: items.length,
      activeItemCount: items.filter(i => i.checked === 0 && i.is_deleted === 0).length,
      projectCount: projects.length,
      activeProjectCount: projects.filter(p => p.is_deleted === 0).length,
    };
  },
});