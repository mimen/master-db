import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Webhook events table for tracking all incoming Todoist webhook deliveries
 * Used for debugging, monitoring, and ensuring webhook reliability
 */
export const todoist_webhook_events = defineTable({
  // Webhook metadata from headers
  delivery_id: v.string(), // X-Todoist-Delivery-ID header (unique per delivery attempt)

  // Event information
  event_name: v.string(), // e.g., "item:added", "project:updated"
  user_id: v.string(), // Todoist user ID who triggered the event
  version: v.string(), // Webhook version from Todoist app config
  triggered_at: v.string(), // ISO timestamp when event was triggered

  // Processing status
  status: v.union(
    v.literal("success"),
    v.literal("failed"),
    v.literal("skipped") // Skipped if version check fails
  ),
  error_message: v.optional(v.string()), // Error details if processing failed

  // Processing metadata
  processed_at: v.number(), // Timestamp when webhook was processed
  processing_time_ms: v.optional(v.number()), // How long processing took

  // Raw payload for debugging
  event_data_summary: v.object({
    entity_id: v.string(), // ID of the affected item/project/label
    entity_type: v.string(), // "item", "project", "label"
  }),

  // Optional: Store initiator info
  initiator_id: v.optional(v.string()),
  initiator_email: v.optional(v.string()),
})
  .index("by_delivery_id", ["delivery_id"]) // For idempotency checks
  .index("by_event_name", ["event_name"]) // Filter by event type
  .index("by_status", ["status"]) // Find failed events
  .index("by_processed_at", ["processed_at"]) // Chronological ordering
  .index("by_entity", ["event_data_summary.entity_id"]); // Track events for specific entities
