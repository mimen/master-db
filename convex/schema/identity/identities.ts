import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A single network handle: one phone / email / WhatsApp JID / iMessage address /
 * Slack user id / Telegram id / Matrix id. High-volume, machine-generated — one
 * per distinct handle ever seen across all bridged networks.
 *
 * Identity key = `value` (the raw handle as the network presents it). The same
 * human's phone can appear as BOTH a WhatsApp JID and a Google Messages number;
 * those are two identity rows with different `value`s but the same `normalized`
 * phone — and that shared `normalized` is exactly what the resolver clusters on
 * to attach both to one `person_id`.
 *
 * `person_id` is null until the resolver attaches it.
 */
export const identities = defineTable({
  person_id: v.optional(v.id("people")), // null until resolved

  kind: v.string(), // phone | email | whatsapp | imessage | gmessages | slack | telegram | matrix | other
  value: v.string(), // raw handle as seen on the network
  normalized: v.string(), // E.164 for phones, lowercased for email, else value

  network: v.optional(v.string()), // beeper network where first seen
  display_name: v.optional(v.string()),
  phone_number: v.optional(v.string()), // if the network exposed one separately
  img_url: v.optional(v.string()),

  message_count: v.number(),
  chat_count: v.number(),

  is_self: v.boolean(),
  source: v.string(), // participant | sender | manual

  first_seen_at: v.optional(v.string()),
  last_seen_at: v.optional(v.string()),
  created_at: v.string(),
  updated_at: v.string(),
})
  .index("by_value", ["value"])
  .index("by_normalized", ["normalized"])
  .index("by_person", ["person_id"])
  .index("by_kind_normalized", ["kind", "normalized"])
  .index("by_unresolved", ["person_id", "normalized"]);
