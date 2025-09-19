import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const initializeSyncState = internalMutation({
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();

    if (!existing) {
      await ctx.db.insert("sync_state", {
        service: "todoist",
        last_sync_token: undefined,
        last_full_sync: new Date().toISOString(),
      });
    }
  },
});

export const upsertProject = internalMutation({
  args: { project: v.any() },
  handler: async (ctx, { project }) => {
    const existing = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", project.id))
      .first();

    const projectData = {
      todoist_id: project.id,
      name: project.name,
      color: project.color,
      sync_version: project.v || 0,
    };

    if (existing) {
      if (existing.sync_version < projectData.sync_version) {
        await ctx.db.patch(existing._id, projectData);
      }
    } else {
      await ctx.db.insert("todoist_projects", projectData);
    }
  },
});

export const upsertItem = internalMutation({
  args: { item: v.any() },
  handler: async (ctx, { item }) => {
    const existing = await ctx.db
      .query("todoist_items")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", item.id))
      .first();

    const itemData = {
      todoist_id: item.id,
      content: item.content,
      project_id: item.project_id || undefined,
      checked: item.checked || 0,
      added_at: item.added_at || new Date().toISOString(),
      sync_version: item.v || 0,
    };

    if (existing) {
      if (existing.sync_version < itemData.sync_version) {
        await ctx.db.patch(existing._id, itemData);
      }
    } else {
      await ctx.db.insert("todoist_items", itemData);
    }
  },
});

export const updateSyncToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const syncState = await ctx.db
      .query("sync_state")
      .withIndex("by_service", (q) => q.eq("service", "todoist"))
      .first();

    if (syncState) {
      await ctx.db.patch(syncState._id, {
        last_sync_token: token,
      });
    }
  },
});