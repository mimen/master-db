import { v } from "convex/values";

import { mutation } from "../../_generated/server";

export default mutation({
  args: {
    entity_ref: v.string(),
    run_id: v.string(),
    kind: v.string(),
    body_markdown: v.union(v.string(), v.null()),
    proposal_json: v.union(v.any(), v.null()),
    error_json: v.union(v.any(), v.null()),
    token_usage: v.union(v.any(), v.null()),
    checkpoint_id: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const last = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref)
      )
      .order("desc")
      .first();
    const sequence = (last?.sequence ?? 0) + 1;
    return ctx.db.insert("agenticThreadMessages", { ...args, sequence });
  },
});
