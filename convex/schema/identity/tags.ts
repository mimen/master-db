import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A tag ↔ (person | chat) attachment, many-to-many. Generalizes the earlier
 * `person_tags` table (see person_tags.ts) to cover GROUP CHATS too, so
 * "browse everything tagged X" is one index lookup across both kinds of
 * entity instead of two separate tables/queries. Part of the private CRM
 * layer (see docs/plans/structured-names.html's "THE RULE: three owners" and
 * field matrix) — Convex-native, app-only, never synced to Apple or Airtable.
 *
 * Exactly ONE of `person_id` / `chat_guid` is set on every row — enforced by
 * the mutation layer (convex/identity/crm.ts's addTag/addChatTag), not the
 * schema (Convex has no "exactly one of" validator). A row with both or
 * neither set is a bug, not a valid state.
 *
 * Tags are freeform lowercase strings, deduped per (person_id|chat_guid) by
 * the mutation layer. `by_tag` is what makes the unified browse-by-tag
 * surface (`listTags`, counting across people AND chats) an index lookup
 * instead of a full scan. Deliberately distinct from Airtable's ORGANIZATIONAL
 * tags (UW Team, departments) — those are a separate, still-deferred
 * read-only pass-through; see person_tags.ts's docstring for that seam.
 */
export const tags = defineTable({
  person_id: v.optional(v.id("people")),
  chat_guid: v.optional(v.string()),
  tag: v.string(),
  created_at: v.string(),
})
  .index("by_person", ["person_id"])
  .index("by_chat", ["chat_guid"])
  .index("by_tag", ["tag"]);
