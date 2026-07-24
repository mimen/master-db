import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

import { pickPrimaryNameIdentity } from "./internal";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * Hard-delete a person and every identity pointing at them, resolved by one of
 * their handles (phone/email). Internal-only, no undo — for removing test rows
 * or a genuinely bogus person, not a user-facing feature. Returns what it
 * removed so a one-off `convex run` reports cleanly.
 */
export const deletePersonByHandle = internalMutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    const match = await ctx.db
      .query("identities")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .first();
    if (!match?.person_id) return { deleted: false as const, reason: "no person for handle" };

    const personId = match.person_id;
    const identities = await ctx.db
      .query("identities")
      .withIndex("by_person", (q) => q.eq("person_id", personId))
      .collect();
    for (const i of identities) await ctx.db.delete(i._id);
    await ctx.db.delete(personId);
    return { deleted: true as const, personId, identitiesDeleted: identities.length };
  },
});

/**
 * One-time backfill for "locked pre-structure" people: those manually named
 * (via Add Contact / rename) BEFORE structured names existed, so they carry a
 * locked display_name but no first/last. The name lock (by design) makes the
 * sync skip them forever, so this fills first/last/nickname from their
 * highest-priority source identity that actually has structured parts —
 * WITHOUT touching their locked display_name (that stays exactly as the human
 * set it). Idempotent: re-running only touches people still missing parts.
 */
export const rederiveLockedStructuredNames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const people = await ctx.db.query("people").collect();
    let scanned = 0;
    let updated = 0;
    for (const p of people) {
      if (p.merged_into) continue;
      if (!p.display_name_locked) continue;
      if (p.first_name || p.last_name) continue; // already has structure
      scanned++;
      const identities = await ctx.db
        .query("identities")
        .withIndex("by_person", (q) => q.eq("person_id", p._id))
        .collect();
      const primary = pickPrimaryNameIdentity(identities);
      if (!primary || (!primary.first_name && !primary.last_name && !primary.nickname)) continue;
      await ctx.db.patch(p._id, {
        first_name: primary.first_name,
        last_name: primary.last_name,
        nickname: primary.nickname,
        updated_at: new Date().toISOString(),
      });
      updated++;
    }
    return { lockedWithoutStructure: scanned, updated };
  },
});
