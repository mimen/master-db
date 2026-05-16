// Spike dev seed – reused by Task 12 of the agentic engine UX plan.
// Field names verified against convex/schema/agentic/* (2026-05-15).
import { mutation } from "../../_generated/server";

export const seedSpikeThread = mutation({
  args: {},
  handler: async (ctx) => {
    const entity_ref = "todoist:task:spike-001";

    // Clear any prior seed for this entity_ref
    const priorRun = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", entity_ref))
      .unique();
    if (priorRun) await ctx.db.delete(priorRun._id);
    for (const m of await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", entity_ref),
      )
      .collect()) {
      await ctx.db.delete(m._id);
    }
    for (const a of await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", entity_ref),
      )
      .collect()) {
      await ctx.db.delete(a._id);
    }

    // Upsert run
    await ctx.db.insert("agenticRuns", {
      entity_ref,
      entity_type: "todoist_task",
      entity_id: "spike-001",
      backend: "claude_sdk",
      resume_cursor: null,
      status: "awaiting_decision",
      last_message_id: null,
      last_run_id: "01HSPIKE",
      last_traceparent: null,
      updated_at: Date.now(),
    });

    // Seed thread messages + activities in shared sequence space
    let seq = 0;
    seq++;
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref,
      sequence: seq,
      run_id: "01HSPIKE",
      kind: "user_message",
      body_markdown: "What should I do with this task?",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    seq++;
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref,
      sequence: seq,
      run_id: "01HSPIKE",
      kind: "reasoning",
      body_markdown: "Checking the task content and any linked notes…",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    seq++;
    await ctx.db.insert("agenticThreadActivities", {
      entity_ref,
      sequence: seq,
      run_id: "01HSPIKE",
      kind: "tool_call",
      name: "search_obsidian",
      input_json: { query: "venue change June 14" },
      output_json: { hits: 2 },
      status: "ok",
      resolved_at: Date.now(),
    });
    seq++;
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref,
      sequence: seq,
      run_id: "01HSPIKE",
      kind: "assistant_message",
      body_markdown: "Found two relevant notes. Drafting options.",
      proposal_json: null,
      error_json: null,
      token_usage: null,
      checkpoint_id: null,
    });
    seq++;
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref,
      sequence: seq,
      run_id: "01HSPIKE",
      kind: "proposal",
      body_markdown: null,
      proposal_json: {
        kind: "proposal",
        summary: "Sarah's email about June 14 venue. Three viable paths.",
        findings: [
          "230 confirmed RSVPs",
          "Studio 51 unavailable",
          "June 21 is open",
        ],
        options: [
          {
            id: "a",
            label: "Confirm Brooklyn Bowl fallback",
            description: "Reply confirming the BB fallback. Keeps June 14 date.",
            confidence: 0.6,
            reversibility: "moderate",
            side_effects: ["sends email", "re-issues 230 tickets"],
          },
          {
            id: "b",
            label: "Propose pushing to June 21",
            description:
              "Reply asking Sarah to move to June 21. Studio 51 confirms open.",
            confidence: 0.85,
            reversibility: "trivial",
            side_effects: ["sends email", "writes Airtable"],
          },
          {
            id: "c",
            label: "Ask Sarah to clarify her preference",
            description: "Reply asking which she prefers.",
            confidence: 0.95,
            reversibility: "trivial",
            side_effects: ["sends email"],
          },
        ],
        recommended_option_id: "b",
        free_text_allowed: true,
      },
      error_json: null,
      token_usage: null,
      checkpoint_id: "ck-spike-1",
    });
  },
});
