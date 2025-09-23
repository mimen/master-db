import { internalMutation } from "../../_generated/server";
import { syncProjectSchema } from "../types/syncApi";

export const upsertProject = internalMutation({
  args: { project: syncProjectSchema },
  handler: async (ctx, { project }) => {
    const existing = await ctx.db
      .query("todoist_projects")
      .withIndex("by_todoist_id", (q) => q.eq("todoist_id", project.id))
      .first();

    // Use timestamp as version since Sync API v1 doesn't provide version field
    const currentVersion = Date.now();

    const projectData = {
      todoist_id: project.id,
      name: project.name,
      color: project.color || "charcoal", // Default to charcoal if no color provided
      parent_id: project.parent_id === null ? undefined : project.parent_id,
      child_order: project.child_order || 0,
      collapsed: project.collapsed,
      shared: project.shared,
      is_deleted: Boolean(project.is_deleted), // Convert to boolean
      is_archived: Boolean(project.is_archived), // Convert to boolean
      is_favorite: Boolean(project.is_favorite), // Convert to boolean
      view_style: project.view_style || "list",
      // Note: Some fields like description, can_assign_tasks, etc. are only available in v1 API
      // They won't be in the sync API, so we'll leave them undefined for sync operations
      description: undefined, // Will be filled by v1 API calls if needed
      can_assign_tasks: undefined, // Will be filled by v1 API calls if needed
      is_shared: undefined, // Will be filled by v1 API calls if needed
      inbox_project: undefined, // Will be filled by v1 API calls if needed
      created_at: project.created_at || new Date().toISOString(),
      updated_at: project.updated_at || new Date().toISOString(),
      sync_version: currentVersion,
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