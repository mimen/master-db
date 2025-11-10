import { Infer, v } from "convex/values";

import { syncItemSchema, syncLabelSchema, syncProjectSchema } from "./syncApi";

/**
 * Todoist Webhook v1 type schemas
 * These match the webhook event structure from https://developer.todoist.com/api/v1#tag/Webhooks
 */

// Initiator (collaborator) who triggered the webhook event
export const webhookInitiatorSchema = v.object({
  id: v.string(),
  email: v.string(),
  full_name: v.string(),
  image_id: v.union(v.string(), v.null()),
  is_premium: v.boolean(),
});

// Event data extra for item:updated events
export const itemUpdatedExtraSchema = v.object({
  old_item: v.optional(syncItemSchema),
  update_intent: v.optional(
    v.union(
      v.literal("item_updated"),
      v.literal("item_completed"),
      v.literal("item_uncompleted")
    )
  ),
});

// Base webhook event structure
const baseWebhookEventSchema = v.object({
  event_name: v.string(),
  user_id: v.string(),
  version: v.string(),
  triggered_at: v.string(),
  initiator: webhookInitiatorSchema,
  event_data_extra: v.optional(v.any()), // Type varies by event
});

// Item webhook events
export const itemWebhookEventSchema = v.object({
  ...baseWebhookEventSchema.fields,
  event_name: v.union(
    v.literal("item:added"),
    v.literal("item:updated"),
    v.literal("item:deleted"),
    v.literal("item:completed"),
    v.literal("item:uncompleted")
  ),
  event_data: syncItemSchema,
  event_data_extra: v.optional(itemUpdatedExtraSchema),
});

// Project webhook events
export const projectWebhookEventSchema = v.object({
  ...baseWebhookEventSchema.fields,
  event_name: v.union(
    v.literal("project:added"),
    v.literal("project:updated"),
    v.literal("project:deleted"),
    v.literal("project:archived"),
    v.literal("project:unarchived")
  ),
  event_data: syncProjectSchema,
});

// Label webhook events
export const labelWebhookEventSchema = v.object({
  ...baseWebhookEventSchema.fields,
  event_name: v.union(
    v.literal("label:added"),
    v.literal("label:updated"),
    v.literal("label:deleted")
  ),
  event_data: syncLabelSchema,
});

// Union of all supported webhook event types
export const webhookEventSchema = v.union(
  itemWebhookEventSchema,
  projectWebhookEventSchema,
  labelWebhookEventSchema
);

// Type inference helpers for TypeScript
export type WebhookInitiator = Infer<typeof webhookInitiatorSchema>;
export type ItemUpdatedExtra = Infer<typeof itemUpdatedExtraSchema>;
export type ItemWebhookEvent = Infer<typeof itemWebhookEventSchema>;
export type ProjectWebhookEvent = Infer<typeof projectWebhookEventSchema>;
export type LabelWebhookEvent = Infer<typeof labelWebhookEventSchema>;
export type WebhookEvent = Infer<typeof webhookEventSchema>;

// Supported event names as a type union
export type SupportedEventName =
  | "item:added"
  | "item:updated"
  | "item:deleted"
  | "item:completed"
  | "item:uncompleted"
  | "project:added"
  | "project:updated"
  | "project:deleted"
  | "project:archived"
  | "project:unarchived"
  | "label:added"
  | "label:updated"
  | "label:deleted";
