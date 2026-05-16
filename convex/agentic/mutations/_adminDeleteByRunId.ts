import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Admin-only: delete every message + activity row tagged with a given run_id.
 * Leading underscore in filename excludes this from the public `api` codegen
 * — invoke via `bunx convex run agentic/mutations/_adminDeleteByRunId ...`.
 *
 * Use when a phantom run pollutes a thread (e.g. UX double-fired before the
 * server-side idempotency guard landed). Does NOT touch `agenticRuns` rows;
 * those are keyed by entity_ref and shared across runs.
 */
export default internalMutation({
  args: { run_id: v.string() },
  handler: async (ctx, { run_id }) => {
    const messages = await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_run_id", (q) => q.eq("run_id", run_id))
      .collect();
    const activities = await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_run_id", (q) => q.eq("run_id", run_id))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);
    for (const a of activities) await ctx.db.delete(a._id);
    return {
      deleted_messages: messages.length,
      deleted_activities: activities.length,
    };
  },
});
