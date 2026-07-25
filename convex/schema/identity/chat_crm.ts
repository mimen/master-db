import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The private CRM layer's chat-side counterpart to `people.is_favorite` /
 * `people.priority` (see people.ts's docstring) — Convex-native, app-only,
 * never synced anywhere else. One row per GROUP chat that's been favorited,
 * prioritized, or otherwise annotated.
 *
 * DMs deliberately do NOT get a row here: per docs/plans/structured-names.html
 * ("MEMBERSHIP ≠ OWNERSHIP") and Milad's decision, a DM's effective CRM is
 * INHERITED from the linked person (apps/imsg/server/map.ts's `mapChat`
 * implements the inheritance — group uses its own chat_crm row, DM falls back
 * to its participant's person.is_favorite/priority). Writing a chat_crm row
 * for a DM's chat_guid would create a second, easily-out-of-sync copy of the
 * same fact the person doc already owns — exactly what the inheritance rule
 * exists to prevent. Nothing stops a caller from inserting one (this table
 * doesn't know a guid's DM/group-ness), but every mutation in
 * `convex/identity/crm.ts` that targets chats is the enforcement point.
 *
 * `chat_guid` is BlueBubbles' merged-conversation guid (the "primary" guid
 * after imsg's service-sibling merge — see apps/imsg's chat-directory.ts) —
 * Convex has no chats table of its own, this is the only place a chat guid
 * appears in the identity graph.
 *
 * Priority is P1–P5, ONE = HIGHEST — same numeric convention as
 * `people.priority` (see that field's docstring for the non-inverted,
 * NOT-like-Todoist warning). No migration concern here: this table is new,
 * so it starts numeric-only, unlike people.priority's transitional union.
 */
export const chat_crm = defineTable({
  chat_guid: v.string(),
  is_favorite: v.optional(v.boolean()),
  priority: v.optional(v.number()),
  created_at: v.string(),
  updated_at: v.string(),
}).index("by_chat_guid", ["chat_guid"]);
