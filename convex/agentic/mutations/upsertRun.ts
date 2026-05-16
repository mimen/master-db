import { v } from "convex/values";

import { authedMutation } from "../../_lib/authed";

export default authedMutation({
  args: {
    entity_ref: v.string(),
    entity_type: v.string(),
    entity_id: v.string(),
    backend: v.string(),
    status: v.string(),
    run_id: v.string(),
    traceparent: v.union(v.string(), v.null()),
    resume_cursor: v.union(v.any(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        last_run_id: args.run_id,
        last_traceparent: args.traceparent,
        resume_cursor: args.resume_cursor,
        updated_at: now,
      });
      return existing._id;
    }
    return ctx.db.insert("agenticRuns", {
      entity_ref: args.entity_ref,
      entity_type: args.entity_type,
      entity_id: args.entity_id,
      backend: args.backend,
      status: args.status,
      last_run_id: args.run_id,
      last_traceparent: args.traceparent,
      last_message_id: null,
      resume_cursor: args.resume_cursor,
      updated_at: now,
    });
  },
});
