import { v } from "convex/values";

import { authedMutation } from "../../_lib/authed";

import { nextSequence } from "./_sequence";

function extractUrgency(proposal_json: unknown): number | null {
  if (typeof proposal_json !== "object" || proposal_json === null) return null;
  const u = (proposal_json as { urgency?: unknown }).urgency;
  return typeof u === "number" ? u : null;
}

export default authedMutation({
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
    const sequence = await nextSequence(ctx.db, args.entity_ref);
    const id = await ctx.db.insert("agenticThreadMessages", { ...args, sequence });

    if (args.kind === "proposal") {
      const run = await ctx.db
        .query("agenticRuns")
        .withIndex("by_entity_ref", (q) => q.eq("entity_ref", args.entity_ref))
        .unique();
      if (run) {
        await ctx.db.patch(run._id, {
          last_urgency: extractUrgency(args.proposal_json),
        });
      }
    }

    return id;
  },
});
