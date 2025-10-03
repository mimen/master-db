import { v } from "convex/values";

import type { Doc } from "../../_generated/dataModel";
import { query } from "../../_generated/server";

/**
 * Get all projects with a specific priority level
 *
 * Used for expanding priority-projects:p1, priority-projects:p2, etc.
 * into individual project views
 */
export const getProjectsByPriority = query({
  args: {
    priorityLevel: v.number(), // 4 = P1, 3 = P2, 2 = P3, 1 = P4
  },
  handler: async (
    ctx,
    args
  ): Promise<Array<Doc<"todoist_projects"> & { metadata: Doc<"todoist_project_metadata"> | null }>> => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    if (!userId) {
      return [];
    }

    // Get all project metadata entries with this priority
    const metadataEntries = await ctx.db
      .query("todoist_project_metadata")
      .filter((q) => q.eq(q.field("priority"), args.priorityLevel))
      .collect();

    // Get the corresponding projects
    const projectsWithMetadata = await Promise.all(
      metadataEntries.map(async (metadata) => {
        const project = await ctx.db
          .query("todoist_projects")
          .withIndex("by_todoist_id", (q) => q.eq("todoist_id", metadata.project_id))
          .first();

        if (!project) return null;

        return {
          ...project,
          metadata,
        };
      })
    );

    // Filter out nulls and sort by child_order
    return projectsWithMetadata
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => a.child_order - b.child_order);
  },
});
