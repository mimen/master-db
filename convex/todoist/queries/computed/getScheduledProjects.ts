import { v } from "convex/values";

import { query } from "../../../_generated/server";

export const getScheduledProjects = query({
  args: {
    from: v.optional(v.string()), // ISO date string
    to: v.optional(v.string()), // ISO date string
  },
  handler: async (ctx, args) => {
    // Get all metadata with scheduled dates
    const metadataWithDates = await ctx.db
      .query("todoist_project_metadata")
      .withIndex("by_scheduled")
      .collect();

    // Filter by date range if provided
    let filteredMetadata = metadataWithDates.filter(m => m.scheduled_date);

    if (args.from) {
      filteredMetadata = filteredMetadata.filter(
        m => m.scheduled_date! >= args.from!
      );
    }

    if (args.to) {
      filteredMetadata = filteredMetadata.filter(
        m => m.scheduled_date! <= args.to!
      );
    }

    if (filteredMetadata.length === 0) {
      return [];
    }

    // Get the projects
    const projectIds = filteredMetadata.map(m => m.project_id);
    const projects = await ctx.db
      .query("todoist_projects")
      .filter(q =>
        q.and(
          q.eq(q.field("is_deleted"), 0),
          q.eq(q.field("is_archived"), 0)
        )
      )
      .collect();

    // Filter to only scheduled projects
    const scheduledProjects = projects.filter(p =>
      projectIds.includes(p.todoist_id)
    );

    // Create metadata lookup
    const metadataByProjectId = new Map(
      filteredMetadata.map(m => [m.project_id, m])
    );

    // Return projects sorted by scheduled date
    return scheduledProjects
      .map(project => {
        const metadata = metadataByProjectId.get(project.todoist_id)!;

        return {
          ...project,
          metadata: {
            priority: metadata.priority,
            scheduledDate: metadata.scheduled_date!,
            description: metadata.description,
          },
          computed: {
            daysUntilDue: metadata.scheduled_date
              ? Math.ceil(
                  (new Date(metadata.scheduled_date).getTime() - Date.now()) /
                  (1000 * 60 * 60 * 24)
                )
              : null,
            isOverdue: metadata.scheduled_date
              ? new Date(metadata.scheduled_date) < new Date()
              : false,
          },
        };
      })
      .sort((a, b) => {
        // Sort by scheduled date, earliest first
        const dateA = new Date(a.metadata.scheduledDate).getTime();
        const dateB = new Date(b.metadata.scheduledDate).getTime();
        return dateA - dateB;
      });
  },
});