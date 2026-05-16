import { v } from "convex/values";

import { authedMutation } from "../../_lib/authed";

import { nextSequence } from "./_sequence";

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
    return ctx.db.insert("agenticThreadMessages", { ...args, sequence });
  },
});
