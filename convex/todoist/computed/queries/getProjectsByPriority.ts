import { v } from "convex/values";

import { query } from "../../../_generated/server";

export const getProjectsByPriority = query({
  args: {
    priority: v.number(), // 1-4
    includeStats: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Get metadata records with the specified priority
    const metadataWithPriority = await ctx.db
      .query("todoist_project_metadata")
      .withIndex("by_priority", q => q.eq("priority", args.priority))
      .collect();

    if (metadataWithPriority.length === 0) {
      return [];
    }

    // Get the projects for these metadata records
    const projectIds = metadataWithPriority.map(m => m.project_id);
    const projects = await ctx.db
      .query("todoist_projects")
      .filter(q =>
        q.and(
          q.eq(q.field("is_deleted"), false),
          q.eq(q.field("is_archived"), false)
        )
      )
      .collect();

    // Filter to only projects with the priority
    const projectsWithPriority = projects.filter(p =>
      projectIds.includes(p.todoist_id)
    );

    // Create metadata lookup
    const metadataByProjectId = new Map(
      metadataWithPriority.map(m => [m.project_id, m])
    );

    // Optionally include stats
    let statsByProjectId = new Map<string, {
      itemCount: number;
      activeCount: number;
      completedCount: number;
    }>();

    if (args.includeStats) {
      const allItems = await ctx.db
        .query("todoist_items")
        .filter(q => q.eq(q.field("is_deleted"), false))
        .collect();

      for (const project of projectsWithPriority) {
        const projectItems = allItems.filter(
          item => item.project_id === project.todoist_id
        );
        statsByProjectId.set(project.todoist_id, {
          itemCount: projectItems.length,
          activeCount: projectItems.filter(i => i.checked === false).length,
          completedCount: projectItems.filter(i => i.checked === true).length,
        });
      }
    }

    // Return enriched projects
    return projectsWithPriority
      .map(project => {
        const metadata = metadataByProjectId.get(project.todoist_id)!;
        const stats = args.includeStats
          ? statsByProjectId.get(project.todoist_id) || {
              itemCount: 0,
              activeCount: 0,
              completedCount: 0,
            }
          : undefined;

        return {
          ...project,
          metadata: {
            priority: metadata.priority,
            scheduledDate: metadata.scheduled_date,
            description: metadata.description,
          },
          ...(stats && { stats }),
        };
      })
      .sort((a, b) => a.child_order - b.child_order);
  },
});