import { v } from "convex/values"

import { authedQuery } from "../../_lib/authed"

import { enrichQueueRun, type EnrichedQueueRun } from "./_enrichQueueRun"

/**
 * Fetch the enriched queue metadata for a single entity by its entity_ref.
 *
 * Powers the queue's right-pane header, which is shared with AgentDrawer and
 * only has the entity_ref to work from. Returns the same shape as the rows
 * from listAwaitingDecision, or null if no run exists for the entity.
 */
export default authedQuery({
  args: {
    entity_ref: v.string(),
  },
  handler: async (ctx, args): Promise<EnrichedQueueRun | null> => {
    const run = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
      .unique()
    if (!run) return null
    return enrichQueueRun(ctx, run)
  },
})
