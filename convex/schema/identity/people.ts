import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A canonical person — a real human that one or more network identities belong
 * to. Convex is the source of truth for the identity graph (decided 2026-06-20):
 * `people` + `identities` both live here; Airtable Humans is an optional
 * downstream link via `airtable_human_id`, not the source.
 *
 * Most rows are created automatically by the resolver (`auto_clustered: true`)
 * by grouping identities that share a normalized phone / email. Hand-curated or
 * manually-merged people set `auto_clustered: false`.
 *
 * `merged_into` tombstones a person that was merged away: when two clusters turn
 * out to be the same human, the loser's identities are repointed to the winner
 * and the loser keeps a `merged_into` pointer so old references still resolve.
 */
export const people = defineTable({
  display_name: v.optional(v.string()),
  // Aggregated structured name parts — copied from a single "primary name
  // identity" chosen by source priority (apple_contact > airtable_human >
  // manual > beeper/other; see recomputePersonAggregates), or set directly by
  // a manual edit (createPerson/renamePerson). Kept internally consistent
  // with display_name: both come from the same identity/edit, never mixed
  // across sources.
  first_name: v.optional(v.string()),
  last_name: v.optional(v.string()),
  nickname: v.optional(v.string()),
  // Convex-native — no source has an organization field (Apple doesn't
  // expose one via BlueBubbles; Airtable Humans has no equivalent column).
  // Convex IS the system of record for this field: only manual edits
  // (createPerson/renamePerson) ever write it, and recomputePersonAggregates
  // must never touch it, syncs included.
  organization: v.optional(v.string()),
  // When true, a human explicitly set this person's name (via "Add Contact"
  // or an in-app rename) — guards ALL name fields (display_name, first_name,
  // last_name, nickname) together, not just display_name. Once set,
  // recomputePersonAggregates must not overwrite any of the four with
  // whatever the primary source-derived identity carries on the next
  // Apple/Airtable/Beeper sync.
  display_name_locked: v.optional(v.boolean()),

  // Denormalised join keys, for fast "who owns this number" lookups without
  // walking the identities table.
  normalized_phones: v.array(v.string()),
  normalized_emails: v.array(v.string()),

  identity_count: v.number(),
  message_count: v.number(),

  is_self: v.boolean(), // the cluster that is Milad himself

  notes: v.optional(v.string()),

  // Optional downstream links — Convex stays canonical, these just point out.
  airtable_human_id: v.optional(v.string()),
  vault_entity: v.optional(v.string()),

  // Private CRM layer — app-native, exists only inside imsg, syncs NOWHERE
  // (never written to Apple or Airtable; see docs/plans/structured-names.html's
  // field matrix, "favorite / priority" row). recomputePersonAggregates must
  // never touch these — same guard as `organization` above.
  is_favorite: v.optional(v.boolean()),
  // Absent = unset, deliberately NOT "normal" — an unset priority means "no
  // opinion recorded," distinct from a person explicitly marked normal
  // priority (e.g. after being downgraded from "high"). Three levels only:
  // finer gradations (P1-P4, numeric scores) aren't asked for by any surface
  // yet and would need a real ranking UI to be worth the complexity.
  priority: v.optional(v.union(v.literal("high"), v.literal("normal"), v.literal("low"))),

  auto_clustered: v.boolean(), // true = resolver-made, false = hand-curated
  merged_into: v.optional(v.id("people")), // tombstone if merged away

  created_at: v.string(),
  updated_at: v.string(),
})
  .index("by_airtable_human", ["airtable_human_id"])
  .index("by_is_self", ["is_self"])
  .index("by_merged_into", ["merged_into"]);
