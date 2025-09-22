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
      parent_id: project.parent_id || undefined,
      child_order: project.child_order || 0,
      is_deleted: project.is_deleted ? 1 : 0,
      is_archived: project.is_archived ? 1 : 0,
      is_favorite: project.is_favorite ? 1 : 0,
      view_style: project.view_style || "list",
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