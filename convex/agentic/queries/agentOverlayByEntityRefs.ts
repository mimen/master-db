import { v } from "convex/values"

import { authedQuery } from "../../_lib/authed"

/**
 * The per-entity agent run overlay used to decorate/sort/filter the standard
 * task list in agent mode. `last_chatted_at` is `run.updated_at` (last-activity
 * proxy). Exported for client reuse.
 */
export interface AgentOverlay {
  hasRun: boolean
  status: string
  last_urgency: number | null
  last_chatted_at: number
}

/**
 * Batch-fetch the agent run overlay for a set of entity_refs.
 *
 * Returns a map keyed by entity_ref; refs with no run are absent from the map.
 * Powers agent-mode decoration/sort/filter on the standard (tasks-first) task
 * list without a runs-first query.
 *
 * Assumes entity_ref is unique per run (the by_entity_ref index plus the
 * runs-per-entity invariant) so `.unique()` is safe; it throws on duplicates,
 * which would signal a data-integrity bug rather than silently merging.
 */
export default authedQuery({
  args: { entity_refs: v.array(v.string()) },
  handler: async (ctx, args): Promise<Record<string, AgentOverlay>> => {
    const out: Record<string, AgentOverlay> = {}
    await Promise.all(
      args.entity_refs.map(async (entity_ref) => {
        const run = await ctx.db
          .query("agenticRuns")
          .withIndex("by_entity_ref", (q) => q.eq("entity_ref", entity_ref))
          .unique()
        if (run) {
          out[entity_ref] = {
            hasRun: true,
            status: run.status,
            last_urgency: run.last_urgency ?? null,
            last_chatted_at: run.updated_at,
          }
        }
      }),
    )
    return out
  },
})
