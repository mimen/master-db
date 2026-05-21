import { internalQuery } from "../../_generated/server";

/**
 * Admin-only diagnostic: for every run in `awaiting_decision`, return the
 * most recent proposal message's `proposal_json` plus the run's current
 * `last_urgency`. Used by the one-time urgency backfill scan over the open
 * queue. Leading underscore keeps it out of the public `api` codegen.
 *
 *   bunx convex run agentic/queries/_adminOpenProposals:default '{}'
 */
export default internalQuery({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("agenticRuns")
      .withIndex("by_status_and_updated_at", (q) =>
        q.eq("status", "awaiting_decision"),
      )
      .collect();

    const out: Array<{
      entity_ref: string;
      last_urgency: number | null | undefined;
      proposal_json: unknown;
    }> = [];

    for (const run of runs) {
      const msgs = await ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", run.entity_ref),
        )
        .collect();
      let latestProposal: unknown = null;
      for (const m of msgs) {
        if (m.kind === "proposal" && m.proposal_json) {
          latestProposal = m.proposal_json;
        }
      }
      out.push({
        entity_ref: run.entity_ref,
        last_urgency: run.last_urgency,
        proposal_json: latestProposal,
      });
    }

    return out;
  },
});
