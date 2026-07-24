import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A person ↔ freeform personal tag, many-to-many. Part of the private CRM
 * layer (see docs/plans/structured-names.html's "THE RULE: three owners" and
 * field matrix, "tags / groups (personal)" row) — Convex-native, app-only,
 * never synced to Apple or Airtable.
 *
 * A table rather than an array field on `people` because the tag-browse
 * surface needs "everyone tagged X" without scanning every person — an
 * array field would force a full table scan for that query; `by_tag` makes
 * it an index lookup.
 *
 * Tags are freeform lowercase strings, deduped per person (enforced by the
 * mutation layer in convex/identity/crm.ts, not the schema — Convex has no
 * unique-compound-index constraint). Deliberately distinct from Airtable's
 * ORGANIZATIONAL tags (UW Team, departments, event links) — those are a
 * separate, deferred pass (read-only pass-through, never written here); see
 * this table's docstring as the seam once that's designed.
 */
export const person_tags = defineTable({
  person_id: v.id("people"),
  tag: v.string(),
  created_at: v.string(),
})
  .index("by_person", ["person_id"])
  .index("by_tag", ["tag"]);
