import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

/**
 * Admin-only diagnostic: dump the full thread (messages + activities) for an
 * entity_ref without going through the user-auth gate. Leading underscore
 * keeps it out of the public `api` codegen. Invoke via:
 *
 *   bunx convex run agentic/queries/_adminGetThread:default \
 *     '{"entity_ref":"todoist:task:..."}'
 *
 * Use for debugging an EXECUTE that didn't behave as expected — see what tool
 * calls the agent actually fired and what they returned.
 */
export default internalQuery({
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
