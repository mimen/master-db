import { v } from "convex/values";

import { internal } from "../../../_generated/api";
import { Doc } from "../../../_generated/dataModel";
import { query } from "../../../_generated/server";

export const getProjectsWithMetadata = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let projectsQuery = ctx.db.query("todoist_projects");

    if (!args.includeDeleted) {
      projectsQuery = projectsQuery.filter(q => q.eq(q.field("is_deleted"), false));
    }
    if (!args.includeArchived) {
      projectsQuery = projectsQuery.filter(q => q.eq(q.field("is_archived"), false));
    }

    const projects = await projectsQuery.collect();

    const allMetadata = await ctx.db
      .query("todoist_project_metadata")
      .collect();

    const metadataByProjectId = new Map(
      allMetadata.map(m => [m.project_id, m])
    );

    const projectIds = projects.map(p => p.todoist_id);
    const allItems = await ctx.db
      .query("todoist_items")
      .filter(q => q.eq(q.field("is_deleted"), false))
      .collect();

    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const filteredActiveItems: Doc<"todoist_items">[] = await ctx.runQuery(
      internal.todoist.internal.index.getFilteredActiveItems,
      {
        assigneeFilter: 'not-assigned-to-others',
        currentUserId: userId,
      }
    );

    // Calculate stats for each project
    const statsByProjectId = new Map<string, {
      itemCount: number;
      activeCount: number;
      completedCount: number;
    }>();

    for (const projectId of projectIds) {
      const projectItems = allItems.filter(item => item.project_id === projectId);
      const filteredProjectActiveItems = filteredActiveItems.filter(item => item.project_id === projectId);

      statsByProjectId.set(projectId, {
        itemCount: projectItems.length,
        activeCount: filteredProjectActiveItems.length, // Use filtered count for active tasks
        completedCount: projectItems.filter(i => i.checked === true).length,
      });
    }

    // Combine everything
    return projects.map(project => {
      const metadata = metadataByProjectId.get(project.todoist_id) || null;
      const stats = statsByProjectId.get(project.todoist_id) || {
        itemCount: 0,
        activeCount: 0,
        completedCount: 0,
      };

      return {
        ...project,
        metadata: metadata ? {
          priority: metadata.priority,
          scheduledDate: metadata.scheduled_date,
          description: metadata.description,
          sourceTaskId: metadata.source_task_id,
          lastUpdated: metadata.last_updated,
        } : null,
        stats,
        computed: {
          isScheduled: !!metadata?.scheduled_date,
          isHighPriority: metadata?.priority === 1,
          completionRate: stats.itemCount > 0
            ? stats.completedCount / stats.itemCount
            : null,
          hasActiveItems: stats.activeCount > 0,
        },
      };
    }).sort((a, b) => a.child_order - b.child_order);
  },
});