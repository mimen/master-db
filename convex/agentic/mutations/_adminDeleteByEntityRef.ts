import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Admin-only: fully remove an entity from the agentic system — the
 * `agenticRuns` row plus every `agenticThreadMessages` and
 * `agenticThreadActivities` row for that entity_ref. Leading underscore
 * keeps it out of public codegen.
 *
 * Use to purge a synthetic/test entity or a thread created in error. This
 * is destructive and irreversible; scope is exactly one entity_ref.
 *
 *   bunx convex run agentic/mutations/_adminDeleteByEntityRef:default \
 *     '{"entity_ref":"todoist:task:..."}'
 */
export default internalMutation({
  args: { entity_ref: v.string() },
  handler: async (ctx, { entity_ref }) => {
    const messages = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", entity_ref),
      )
      .collect();
    const activities = await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", entity_ref),
      )
      .collect();
    const runs = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", entity_ref))
      .collect();

    for (const m of messages) await ctx.db.delete(m._id);
    for (const a of activities) await ctx.db.delete(a._id);
    for (const r of runs) await ctx.db.delete(r._id);

    return {
      deleted_runs: runs.length,
      deleted_messages: messages.length,
      deleted_activities: activities.length,
    };
  },
});
