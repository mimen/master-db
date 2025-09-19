import { mutation } from "./_generated/server";

export const all = mutation({
  handler: async (ctx) => {
    // Get all items and delete them
    const items = await ctx.db.query("todoist_items").collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // Get all projects and delete them
    const projects = await ctx.db.query("todoist_projects").collect();
    for (const project of projects) {
      await ctx.db.delete(project._id);
    }

    // Get all sync states and delete them
    const syncStates = await ctx.db.query("sync_state").collect();
    for (const state of syncStates) {
      await ctx.db.delete(state._id);
    }

    console.log(`Cleared ${items.length} items, ${projects.length} projects, and ${syncStates.length} sync states`);
    
    return {
      itemsDeleted: items.length,
      projectsDeleted: projects.length,
      syncStatesDeleted: syncStates.length,
    };
  },
});