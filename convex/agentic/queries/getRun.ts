import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export default authedQuery({
  args: { entity_ref: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
  },
});
