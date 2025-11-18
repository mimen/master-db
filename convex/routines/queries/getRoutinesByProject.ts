import { v } from "convex/values";

import { query } from "../../_generated/server";

/**
 * Get routines for a specific project
 * Filters routines by todoistProjectId and excludes deferred routines
 * Returns active routines sorted alphabetically by name
 */
export const getRoutinesByProject = query({
  args: {
    projectId: v.string(),
    includeDeferred: v.optional(v.boolean()), // Optional: include deferred routines
  },
  handler: async (ctx, args) => {
    const { projectId, includeDeferred = false } = args;

    // Query using the by_project index for efficient filtering
    let routinesQuery = ctx.db
      .query("routines")
      .withIndex("by_project", (q) => q.eq("todoistProjectId", projectId));

    // Filter out deferred routines unless explicitly requested
    if (!includeDeferred) {
      routinesQuery = routinesQuery.filter((q) => q.eq(q.field("defer"), false));
    }

    const routines = await routinesQuery.collect();

    // Sort by defer status (active first), then by name
    return routines.sort((a, b) => {
      // Active routines come first (if includeDeferred is true)
      if (a.defer !== b.defer) {
        return a.defer ? 1 : -1;
      }
      // Then sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  },
});
