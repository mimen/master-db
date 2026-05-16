import { internalQuery } from "../../_generated/server";

/**
 * Admin-only diagnostic: list every entity_ref that has at least one
 * agenticRuns row, ordered by most recent activity. Used for sweeping
 * across all conversations for evaluation passes.
 */
export default internalQuery({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("agenticRuns").collect();
    runs.sort((a, b) => b.updated_at - a.updated_at);
    return runs.map((r) => ({
      entity_ref: r.entity_ref,
      entity_type: r.entity_type,
      status: r.status,
      last_run_id: r.last_run_id,
      updated_at: r.updated_at,
    }));
  },
});
