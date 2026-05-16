import { v } from "convex/values";

import { authedMutation } from "../../_lib/authed";

export default authedMutation({
  args: {
    entity_ref: v.string(),
    status: v.string(),
    last_message_id: v.union(v.id("agenticThreadMessages"), v.null()),
    resume_cursor: v.union(v.any(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
    if (!existing) {
      throw new Error(`No agenticRuns row for entity_ref=${args.entity_ref}`);
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      last_message_id: args.last_message_id,
      resume_cursor: args.resume_cursor,
      updated_at: Date.now(),
    });
  },
});
