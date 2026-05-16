import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export default authedQuery({
  args: { entity_ref: v.string() },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref),
      )
      .collect();
    const acts = await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", args.entity_ref),
      )
      .collect();
    const combined = [
      ...msgs.map((m) => ({ ...m, row_type: "message" as const })),
      ...acts.map((a) => ({ ...a, row_type: "activity" as const })),
    ];
    combined.sort((a, b) => a.sequence - b.sequence);
    return combined;
  },
});
