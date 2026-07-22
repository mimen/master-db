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
  // When true, a human explicitly set this name (via "Add Contact" or an
  // in-app rename) — recomputePersonAggregates must not overwrite it with
  // whatever the longest source-derived identity name happens to be on the
  // next Apple/Airtable/Beeper sync.
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

  auto_clustered: v.boolean(), // true = resolver-made, false = hand-curated
  merged_into: v.optional(v.id("people")), // tombstone if merged away

  created_at: v.string(),
  updated_at: v.string(),
})
  .index("by_airtable_human", ["airtable_human_id"])
  .index("by_is_self", ["is_self"])
  .index("by_merged_into", ["merged_into"]);
