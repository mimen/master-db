import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * ⚠️ SUPERSEDED by `tags.ts` (generalized to cover chats, not just people) —
 * kept declared here ONLY so this table's still-live rows keep validating
 * post-deploy while `migratePersonTags` (convex/identity/admin.ts) copies
 * them over. Nothing reads or writes `person_tags` anymore: `crm.ts`'s
 * addTag/removeTag and `queries.ts`'s tag lookups all target `tags` now. Once
 * `migratePersonTags` has run in every environment with data (confirmed via
 * its own reported counts) and that's verified, a follow-up deploy removes
 * this table from the schema barrel — see this repo's PR description for the
 * exact order. Do not add new code against this table.
 *
 * Status 2026-07-24: migratePersonTags ran against the live deployment and
 * reported 0 scanned / 0 migrated — this table is empty. The removal deploy
 * is therefore safe whenever someone picks it up; it was deliberately NOT
 * folded into the merge, because dropping the table also orphans the
 * migration that reads it (and migratePriorityToNumeric likewise depends on
 * the transitional union in people.ts). Removing table + migrations + their
 * tests together is a clean follow-up PR, not an inline integration edit.
 *
 * Original docstring, for archaeology: a person ↔ freeform personal tag,
 * many-to-many — Convex-native, app-only, never synced to Apple or Airtable.
 * A table rather than an array field on `people` because the tag-browse
 * surface needs "everyone tagged X" without scanning every person; `by_tag`
 * made it an index lookup. Tags were freeform lowercase strings, deduped per
 * person by the mutation layer (Convex has no unique-compound-index
 * constraint). Deliberately distinct from Airtable's ORGANIZATIONAL tags (UW
 * Team, departments, event links) — those remain a separate, deferred,
 * read-only pass-through.
 */
export const person_tags = defineTable({
  person_id: v.id("people"),
  tag: v.string(),
  created_at: v.string(),
})
  .index("by_person", ["person_id"])
  .index("by_tag", ["tag"]);
