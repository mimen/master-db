import { v } from "convex/values";

import { internalMutation } from "../../../_generated/server";

/**
 * Extracts project metadata from special tasks.
 * Tasks with 'project-metadata' label or starting with '*' are treated as metadata carriers.
 */
export const extractProjectMetadata = internalMutation({
  args: {
    projectId: v.optional(v.string()), // If provided, only extract for this project
  },
  handler: async (ctx, args) => {
    // Build query for metadata tasks
    let itemsQuery = ctx.db
      .query("todoist_items")
      .filter(q => q.eq(q.field("is_deleted"), 0));

    // Collect all items first (we'll filter in memory for complex conditions)
    const allItems = await itemsQuery.collect();

    // Filter for metadata tasks
    const metadataTasks = allItems.filter(item => {
      // Check if specific project requested
      if (args.projectId && item.project_id !== args.projectId) {
        return false;
      }

      // Check if it's a metadata task
      const hasMetadataLabel = item.labels.includes("project-metadata");
      const startsWithAsterisk = item.content.startsWith("*");

      return hasMetadataLabel || startsWithAsterisk;
    });

    // Group by project
    const tasksByProject = new Map<string, typeof metadataTasks[0]>();

    for (const task of metadataTasks) {
      if (!task.project_id) continue;

      // Keep the most recently updated task per project
      const existing = tasksByProject.get(task.project_id);
      if (!existing || (task.sync_version > existing.sync_version)) {
        tasksByProject.set(task.project_id, task);
      }
    }

    // Update or create metadata for each project
    for (const [projectId, task] of tasksByProject) {
      // Check if project exists
      const project = await ctx.db
        .query("todoist_projects")
        .filter(q => q.eq(q.field("todoist_id"), projectId))
        .first();

      if (!project) continue;

      // Check for existing metadata
      const existingMetadata = await ctx.db
        .query("todoist_project_metadata")
        .withIndex("by_project", q => q.eq("project_id", projectId))
        .first();

      const metadataData = {
        project_id: projectId,
        priority: task.priority,
        scheduled_date: task.due?.date,
        description: task.description,
        source_task_id: task.todoist_id,
        last_updated: Date.now(),
        sync_version: Date.now(),
      };

      if (existingMetadata) {
        // Update if newer
        if (task.sync_version > existingMetadata.sync_version) {
          await ctx.db.patch(existingMetadata._id, metadataData);
        }
      } else {
        // Create new
        await ctx.db.insert("todoist_project_metadata", metadataData);
      }
    }

    return {
      processedProjects: tasksByProject.size,
      metadataTasksFound: metadataTasks.length,
    };
  },
});