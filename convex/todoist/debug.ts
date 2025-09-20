import { query } from "../_generated/server";
import { v } from "convex/values";

export const getRecentlyModifiedItems = query({
  handler: async (ctx) => {
    const items = await ctx.db
      .query("todoist_items")
      .collect();
    
    // Sort by sync_version descending to see most recently modified
    const sorted = items.sort((a, b) => b.sync_version - a.sync_version);
    
    // Return top 10
    return sorted.slice(0, 10).map(item => ({
      content: item.content,
      checked: item.checked,
      sync_version: item.sync_version,
      project_id: item.project_id,
      todoist_id: item.todoist_id,
    }));
  },
});

export const getCompletedItems = query({
  handler: async (ctx) => {
    const items = await ctx.db
      .query("todoist_items")
      .filter(q => q.eq(q.field("checked"), 1))
      .collect();
    
    return items.map(item => ({
      content: item.content,
      checked: item.checked,
      completed_at: item.completed_at,
      sync_version: item.sync_version,
    }));
  },
});

export const getDeletedItems = query({
  handler: async (ctx) => {
    const items = await ctx.db
      .query("todoist_items")
      .filter(q => q.eq(q.field("is_deleted"), 1))
      .collect();
    
    return items.map(item => ({
      content: item.content,
      checked: item.checked,
      is_deleted: item.is_deleted,
      sync_version: item.sync_version,
    }));
  },
});

export const searchItemByContent = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, { searchTerm }) => {
    const items = await ctx.db
      .query("todoist_items")
      .collect();
    
    const matches = items.filter(item => 
      item.content.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    return matches.map(item => ({
      content: item.content,
      description: item.description,
      checked: item.checked,
      sync_version: item.sync_version,
      todoist_id: item.todoist_id,
      is_deleted: item.is_deleted,
      completed_at: item.completed_at,
      priority: item.priority,
      due: item.due,
    }));
  },
});

export const getItemStats = query({
  handler: async (ctx) => {
    const items = await ctx.db.query("todoist_items").collect();
    
    return {
      total: items.length,
      checked: items.filter(i => i.checked === 1).length,
      unchecked: items.filter(i => i.checked === 0).length,
      deleted: items.filter(i => i.is_deleted === 1).length,
      active: items.filter(i => i.checked === 0 && i.is_deleted === 0).length,
    };
  },
});

export const getRawSyncData = query({
  handler: async (ctx) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();
    
    return {
      currentSyncToken: syncState?.last_sync_token,
      lastFullSync: syncState?.last_full_sync,
      lastIncrementalSync: syncState?.last_incremental_sync,
    };
  },
});

export const getProjectByName = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const projects = await ctx.db
      .query("todoist_projects")
      .collect();
    
    const matches = projects.filter(project => 
      project.name.toLowerCase().includes(name.toLowerCase())
    );
    
    return matches.map(project => ({
      todoist_id: project.todoist_id,
      name: project.name,
      is_deleted: project.is_deleted,
      is_favorite: project.is_favorite,
      color: project.color,
      sync_version: project.sync_version,
    }));
  },
});