import { v } from "convex/values";

import { authedMutation } from "../../_lib/authed";

import { nextSequence } from "./_sequence";

export const start = authedMutation({
  args: {
    entity_ref: v.string(),
    run_id: v.string(),
    kind: v.string(),
    name: v.string(),
    input_json: v.any(),
  },
  handler: async (ctx, args) => {
    const sequence = await nextSequence(ctx.db, args.entity_ref);
    return ctx.db.insert("agenticThreadActivities", {
      ...args,
      sequence,
      output_json: null,
      status: "pending",
      resolved_at: null,
    });
  },
});

export const resolve = authedMutation({
  args: {
    id: v.id("agenticThreadActivities"),
    status: v.string(),
    output_json: v.union(v.any(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      output_json: args.output_json,
      resolved_at: Date.now(),
    });
  },
});
