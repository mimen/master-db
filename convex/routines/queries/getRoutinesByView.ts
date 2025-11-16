import { query } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Get routines for a view (includes deferred/paused routines)
 * Returns all routines sorted by defer status (active first) then by name
 */
export const getRoutinesByView = query({
  args: {
    list: v.object({
      type: v.literal("routines"),
      view: v.string(),
    }),
  },
  handler: async (ctx) => {
    // Get all routines
    const routines = await ctx.db.query("routines").collect();

    // Sort by defer status (active first), then by name
    return routines.sort((a, b) => {
      // Active routines come first
      if (a.defer !== b.defer) {
        return a.defer ? 1 : -1;
      }
      // Then sort alphabetically by name
      return a.name.localeCompare(b.name);
    });
  },
});
