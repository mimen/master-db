import { v } from "convex/values";

import { internalQuery } from "../../_generated/server";

/**
 * Query to check if a webhook event with a specific delivery ID has already been processed
 * Used for idempotency - prevents processing the same webhook twice
 */
export const getWebhookEventByDeliveryId = internalQuery({
  args: {
    deliveryId: v.string(),
  },
  handler: async (ctx, { deliveryId }) => {
    const event = await ctx.db
      .query("todoist_webhook_events")
      .withIndex("by_delivery_id", (q) => q.eq("delivery_id", deliveryId))
      .first();

    return event;
  },
});
