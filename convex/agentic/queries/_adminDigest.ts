import { internalQuery } from "../../_generated/server";

/**
 * Admin-only diagnostic: compact digest of every conversation —
 * latest proposal summary, options (label only), tool-call count,
 * any execution_result body. For sweep-the-whole-corpus evaluation.
 */
export default internalQuery({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("agenticRuns").collect();
    runs.sort((a, b) => b.updated_at - a.updated_at);
    const out: Array<Record<string, unknown>> = [];
    for (const r of runs) {
      const messages = await ctx.db
        .query("agenticThreadMessages")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", r.entity_ref),
        )
        .collect();
      const activities = await ctx.db
        .query("agenticThreadActivities")
        .withIndex("by_entity_ref_and_sequence", (q) =>
          q.eq("entity_ref", r.entity_ref),
        )
        .collect();
      const proposals = messages.filter((m) => m.kind === "proposal");
      const lastProposal = proposals[proposals.length - 1];
      const executions = messages.filter((m) => m.kind === "execution_result");
      const lastExecution = executions[executions.length - 1];
      const clarifications = messages.filter(
        (m) => m.kind === "proposal" && (m.proposal_json as { kind?: string } | null)?.kind === "clarification",
      );
      const errors = messages.filter((m) => m.kind === "error");
      const userMessages = messages.filter((m) => m.kind === "user_message");
      const proposalJson = (lastProposal?.proposal_json ?? null) as
        | { kind?: string; summary?: string; options?: Array<{ id: string; label: string; confidence: number; reversibility: string }>; question?: string; recommended_option_id?: string; free_text_allowed?: boolean }
        | null;
      out.push({
        entity_ref: r.entity_ref,
        status: r.status,
        run_count: new Set(messages.map((m) => m.run_id)).size,
        tool_call_count: activities.length,
        proposal_count: proposals.length,
        execution_count: executions.length,
        clarification_count: clarifications.length,
        error_count: errors.length,
        user_message_count: userMessages.length,
        last_proposal: proposalJson
          ? {
              kind: proposalJson.kind,
              summary: proposalJson.summary?.slice(0, 250),
              question: proposalJson.question,
              recommended_option_id: proposalJson.recommended_option_id,
              free_text_allowed: proposalJson.free_text_allowed,
              options: (proposalJson.options ?? []).map((o) => ({
                id: o.id,
                label: o.label,
                confidence: o.confidence,
                reversibility: o.reversibility,
              })),
            }
          : null,
        last_execution: lastExecution
          ? { body: (lastExecution.body_markdown ?? "").slice(0, 250) }
          : null,
      });
    }
    return out;
  },
});
