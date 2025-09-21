import { query } from "../../_generated/server";

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