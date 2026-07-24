import { v } from "convex/values";

import { mutation } from "../_generated/server";

import { requireIdentityKey } from "./key";

/**
 * The private CRM layer: favorites, priority, and personal tags. Split out
 * from mutations.ts (which owns the name-identity edit surface) because this
 * is a distinct concept — Convex-native metadata that has no source-of-truth
 * anywhere else and must NEVER be written to Apple or Airtable (see
 * docs/plans/structured-names.html's "THE RULE: three owners" and field
 * matrix). recomputePersonAggregates (internal.ts) never references these
 * fields, so a sync re-run can't clobber them — see internal.test.ts's
 * "CRM fields survive a sync" coverage.
 *
 * Every mutation here follows the module's established no-op-write
 * discipline: skip the patch (and the updated_at bump that comes with it)
 * entirely when the requested value already matches what's stored, so a
 * repeated tap of an already-set favorite/priority/tag doesn't invalidate
 * every reactive query subscribed to the person.
 */

/** Toggle a person's favorite flag. No-op (no write) when the value already
 * matches — `is_favorite` unset reads as `false`, so setting `false` on a
 * never-favorited person is also a no-op. */
export const setFavorite = mutation({
  args: { key: v.string(), personId: v.id("people"), is_favorite: v.boolean() },
  handler: async (ctx, { key, personId, is_favorite }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");

    const current = person.is_favorite ?? false;
    if (current === is_favorite) return;

    await ctx.db.patch(personId, { is_favorite, updated_at: new Date().toISOString() });
  },
});

/** Set (or clear) a person's priority. Passing `null` or omitting `priority`
 * both clear it back to unset — distinct from "normal," which is a deliberate
 * choice, not the absence of one (see schema/identity/people.ts's docstring).
 * No-op when the requested value already matches what's stored. */
export const setPriority = mutation({
  args: {
    key: v.string(),
    personId: v.id("people"),
    priority: v.optional(v.union(v.literal("high"), v.literal("normal"), v.literal("low"), v.null())),
  },
  handler: async (ctx, { key, personId, priority }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");

    const next = priority ?? undefined;
    if (person.priority === next) return;

    await ctx.db.patch(personId, { priority: next, updated_at: new Date().toISOString() });
  },
});

/** Add a personal tag to a person — trimmed and lowercased, deduped per
 * person (a person_tags table, not an array field, so "browse everyone
 * tagged X" is an index lookup rather than a full table scan — see
 * schema/identity/person_tags.ts). No-op when the person already carries
 * this tag. */
export const addTag = mutation({
  args: { key: v.string(), personId: v.id("people"), tag: v.string() },
  handler: async (ctx, { key, personId, tag }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");

    const normalized = tag.trim().toLowerCase();
    if (!normalized) throw new Error("Tag can't be empty");

    const existing = await ctx.db
      .query("person_tags")
      .withIndex("by_person", (q) => q.eq("person_id", personId))
      .collect();
    if (existing.some((t) => t.tag === normalized)) return;

    await ctx.db.insert("person_tags", {
      person_id: personId,
      tag: normalized,
      created_at: new Date().toISOString(),
    });
  },
});

/** Remove a personal tag from a person. No-op (nothing to delete) when the
 * person doesn't carry this tag. */
export const removeTag = mutation({
  args: { key: v.string(), personId: v.id("people"), tag: v.string() },
  handler: async (ctx, { key, personId, tag }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");

    const normalized = tag.trim().toLowerCase();
    const existing = await ctx.db
      .query("person_tags")
      .withIndex("by_person", (q) => q.eq("person_id", personId))
      .collect();
    const match = existing.find((t) => t.tag === normalized);
    if (!match) return;

    await ctx.db.delete(match._id);
  },
});
