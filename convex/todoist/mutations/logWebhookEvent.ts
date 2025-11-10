import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Log a webhook event to the database for monitoring and debugging
 */
export const logWebhookEvent = internalMutation({
  args: {
    delivery_id: v.string(),
    event_name: v.string(),
    user_id: v.string(),
    version: v.string(),
    triggered_at: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    error_message: v.optional(v.string()),
    processed_at: v.number(),
    processing_time_ms: v.optional(v.number()),
    event_data_summary: v.object({
      entity_id: v.string(),
      entity_type: v.string(),
    }),
    initiator_id: v.optional(v.string()),
    initiator_email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("todoist_webhook_events", args);
  },
});
