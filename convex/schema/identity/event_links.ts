import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A typed link from a person or GROUP chat to an Airtable Events record
 * (base `app39VsA3z85GTMbT`, table `tblMUAZPSnj9al2AC`) — "this person is
 * associated with this AUF event" / "this group chat is this event's planning
 * thread." Convex-native join row; Airtable stays the source of truth for the
 * event itself (name, date, everything else) — this table only stores enough
 * to resolve back to it (`airtable_event_id`) and render a label without a
 * live Airtable call (`event_name`, denormalized at link time).
 *
 * `event_name` can drift from Airtable if the event is later renamed there —
 * acceptable staleness for a display cache, same tradeoff `people.display_name`
 * already makes relative to its sources. Re-linking (unlink + linkEvent again)
 * refreshes it; there's no live sync back from Airtable to keep it current.
 *
 * Exactly ONE of `person_id` / `chat_guid` is set on every row — enforced by
 * the mutation layer (convex/identity/events.ts's linkEvent), not the schema,
 * same convention as tags.ts. A person and a chat can each carry MULTIPLE
 * event links (someone/some group tied to more than one event over time) —
 * that's why this is a table, not a single optional field.
 */
export const event_links = defineTable({
  person_id: v.optional(v.id("people")),
  chat_guid: v.optional(v.string()),
  airtable_event_id: v.string(),
  event_name: v.string(),
  created_at: v.string(),
})
  .index("by_person", ["person_id"])
  .index("by_chat", ["chat_guid"])
  .index("by_event", ["airtable_event_id"]);
