import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Admin-only: directly patch `last_urgency` on a run by entity_ref. Used by
 * the one-time urgency backfill scan over the open queue, and available for
 * manual recalibration. Leading underscore keeps it out of public codegen.
 *
 *   bunx convex run agentic/mutations/_adminSetUrgency:default \
 *     '{"entity_ref":"todoist:task:...","urgency":0.6}'
 */
export default internalMutation({
  args: {
    entity_ref: v.string(),
    urgency: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique();
    if (!run) {
      throw new Error(`No agenticRuns row for entity_ref=${args.entity_ref}`);
    }
    await ctx.db.patch(run._id, { last_urgency: args.urgency });
    return run._id;
  },
});
