import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

/**
 * Find a successfully processed (or skipped) webhook event for a delivery ID.
 * Used for idempotency. Failed attempts are ignored so Todoist's retry is processed.
 */
export const getWebhookEventByDeliveryId = internalQuery({
  args: {
    deliveryId: v.string(),
  },
  handler: async (ctx, { deliveryId }) => {
    const event = await ctx.db
      .query("todoist_webhook_events")
      .withIndex("by_delivery_id", (q) => q.eq("delivery_id", deliveryId))
      .filter((q) => q.neq(q.field("status"), "failed"))
      .first();

    return event;
  },
});
