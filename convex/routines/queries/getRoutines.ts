import { v } from "convex/values";
import { query } from "../../_generated/server";

export const getRoutines = query({
  args: {
    deferFilter: v.optional(v.union(v.literal("active"), v.literal("deferred"), v.literal("all"))),
  },
  handler: async (ctx, { deferFilter = "all" }) => {
    let routines;

    // Apply defer filter
    if (deferFilter === "active") {
      routines = await ctx.db
        .query("routines")
        .withIndex("by_defer", (q) => q.eq("defer", false))
        .collect();
    } else if (deferFilter === "deferred") {
      routines = await ctx.db
        .query("routines")
        .withIndex("by_defer", (q) => q.eq("defer", true))
        .collect();
    } else {
      routines = await ctx.db.query("routines").collect();
    }

    // Sort by name alphabetically
    return routines.sort((a, b) => a.name.localeCompare(b.name));
  },
});
