import { v } from "convex/values";

import { query } from "../../_generated/server";

export default query({
  args: { entity_ref: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
  },
});
