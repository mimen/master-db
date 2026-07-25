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

/** high→2, normal→3, low→4 — deliberately leaves room at 1 and 5 (nobody
 * migrating in gets bumped all the way to the new extremes; a human has to
 * explicitly choose P1/P5 going forward). See schema/identity/people.ts's
 * docstring for the full P1–P5/one-is-highest convention. */
const PRIORITY_STRING_TO_NUMBER: Record<string, number> = { high: 2, normal: 3, low: 4 };

/**
 * One-time migration: converts every `people.priority` row still holding the
 * old 3-level string ("high"|"normal"|"low") to its P1–P5 numeric equivalent.
 * Idempotent — rows already numeric, already unset, or (defensively) holding
 * something unrecognized are left untouched and counted separately, so
 * re-running after a full migration is a safe no-op that reports zero
 * `migrated`.
 *
 * DEPLOY ORDER (see schema/identity/people.ts's docstring for why): this
 * migration can only run AFTER the transitional
 * `v.union(v.number(), v.literal(...))` schema for `people.priority` is live
 * — deploying that schema and this function happen in the SAME `convex
 * deploy` (they're one push of the whole convex/ directory), so there's no
 * ordering risk between them. Run this migration once right after that
 * deploy lands in each environment with data. Only once its reported
 * `unrecognized` is 0 and `migrated` has stopped changing across runs should
 * a FOLLOW-UP deploy narrow `people.priority` back to `v.optional(v.number())`
 * — that follow-up deploy is what actually enforces "no more strings," so
 * don't skip it once migration is verified.
 */
export const migratePriorityToNumeric = internalMutation({
  args: {},
  handler: async (ctx) => {
    const people = await ctx.db.query("people").collect();
    let scanned = 0;
    let migrated = 0;
    let alreadyNumeric = 0;
    let unset = 0;
    let unrecognized = 0;
    for (const p of people) {
      scanned++;
      const raw = p.priority;
      if (raw === undefined) {
        unset++;
        continue;
      }
      if (typeof raw === "number") {
        alreadyNumeric++;
        continue;
      }
      const mapped = PRIORITY_STRING_TO_NUMBER[raw];
      if (mapped === undefined) {
        // Defensive only — the schema's literal union means this can't
        // actually happen, but a migration should never silently drop data
        // it doesn't understand.
        unrecognized++;
        continue;
      }
      await ctx.db.patch(p._id, { priority: mapped, updated_at: new Date().toISOString() });
      migrated++;
    }
    return { scanned, migrated, alreadyNumeric, unset, unrecognized };
  },
});

/**
 * One-time migration: copies every `person_tags` row into the unified `tags`
 * table (person_id set, chat_guid absent) — see schema/identity/tags.ts and
 * person_tags.ts's "SUPERSEDED" docstring. Idempotent — a row already present
 * in `tags` for the same (person_id, tag) is skipped and counted separately,
 * so re-running is a safe no-op once fully migrated.
 *
 * DEPLOY ORDER: run once right after the deploy that introduces the `tags`
 * table and switches crm.ts/queries.ts to read/write it (this migration, that
 * schema addition, and that code switch are all part of the SAME `convex
 * deploy`, so there's no ordering risk between them — unlike the priority
 * migration, `tags` isn't replacing a field's TYPE on an existing table, it's
 * an all-new table, so there's no transitional-schema step here). Once this
 * has run in every environment with data and `person_tags` is confirmed
 * empty of anything not yet copied, a follow-up deploy can drop `person_tags`
 * from the schema barrel (schema/identity/index.ts) — the underlying rows
 * are dead data at that point and don't need a separate deletion pass unless
 * disk/readability hygiene calls for it.
 */
export const migratePersonTags = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oldRows = await ctx.db.query("person_tags").collect();
    let scanned = 0;
    let migrated = 0;
    let alreadyPresent = 0;
    for (const row of oldRows) {
      scanned++;
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_person", (q) => q.eq("person_id", row.person_id))
        .collect();
      if (existing.some((t) => t.tag === row.tag)) {
        alreadyPresent++;
        continue;
      }
      await ctx.db.insert("tags", {
        person_id: row.person_id,
        tag: row.tag,
        created_at: row.created_at,
      });
      migrated++;
    }
    return { scanned, migrated, alreadyPresent };
  },
});
