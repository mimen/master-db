import { query } from "../../_generated/server";
import { v } from "convex/values";

/**
 * Get routines for a view (filtered by defer status)
 * Returns active routines sorted by name
 */
export const getRoutinesByView = query({
  args: {
    list: v.object({
      type: v.literal("routines"),
      view: v.string(),
    }),
  },
  handler: async (ctx) => {
    // Get all active routines (defer=false)
    const routines = await ctx.db
      .query("routines")
      .withIndex("by_defer", (q) => q.eq("defer", false))
      .collect();

    // Sort by name
    return routines.sort((a, b) => a.name.localeCompare(b.name));
  },
});
