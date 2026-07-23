import { v } from "convex/values";

import { mutation } from "../_generated/server";

import { ingestOneCard } from "./ingestContacts";
import { recomputePersonAggregates } from "./internal";
import { requireIdentityKey } from "./key";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * The v1 "Add Contact" action for an unknown handle in imsg: creates a
 * Convex-only person for a raw phone/email with no existing identity match.
 * Deliberately does NOT write to Apple Contacts — that's a distinct,
 * deferred capability (see convex/identity/ingestContacts.ts's docstring and
 * the phase-3 write-back/sync plan). If Apple Contacts later gains this same
 * handle, resolveIdentities's cross-source matching links the two into one
 * person on the next run — no special-casing needed here.
 *
 * Two non-obvious cases this handles:
 *  - Dedupe onto an existing person must not silently discard a typed name:
 *    the UI flow here is "type a name, tap Add Contact," so a provided
 *    display_name is applied (and locked) onto the person it dedupes to.
 *  - The by_normalized index can hold multiple rows for one normalized key
 *    (different networks/sources). .first() would pick an arbitrary row and
 *    could miss one that already has a person_id (duplicate person) or treat
 *    unresolved orphan rows as "no match" when they should be linked to the
 *    person we're about to create.
 */
export const createPerson = mutation({
  args: { key: v.string(), handle: v.string(), display_name: v.optional(v.string()) },
  handler: async (ctx, { key, handle, display_name }) => {
    requireIdentityKey(key);
    const trimmed = handle.trim();
    const normalized = normalizePhone(trimmed) || normalizeEmail(trimmed) || trimmed;
    const kind: "phone" | "email" = normalizePhone(trimmed) ? "phone" : "email";

    const rows = await ctx.db
      .query("identities")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .collect();

    let dedupePersonId: (typeof rows)[number]["person_id"] | null = null;
    for (const r of rows) {
      if (!r.person_id) continue;
      const p = await ctx.db.get(r.person_id);
      if (p && !p.merged_into) {
        dedupePersonId = r.person_id;
        break;
      }
    }

    if (dedupePersonId) {
      if (display_name) {
        // Deliberate rename semantics: the user typed this name on purpose,
        // so it wins over whatever the person is currently named.
        await ctx.db.patch(dedupePersonId, {
          display_name,
          display_name_locked: true,
          updated_at: new Date().toISOString(),
        });
      }
      return { created: false as const, personId: dedupePersonId };
    }

    // No row resolves to a live person — either there were none, or every
    // row is an orphan (ingested but never clustered/resolved). Either way
    // we create the person and, in the orphan case, link those rows to it
    // instead of leaving them stranded and creating a duplicate on the next
    // sync's cross-source match.
    const now = new Date().toISOString();
    const personId = await ctx.db.insert("people", {
      display_name,
      display_name_locked: Boolean(display_name),
      normalized_phones: [],
      normalized_emails: [],
      identity_count: 0,
      message_count: 0,
      is_self: false,
      auto_clustered: false, // hand-created via "Add Contact", not resolver/source-ingest inferred
      created_at: now,
      updated_at: now,
    });

    for (const r of rows) {
      await ctx.db.patch(r._id, { person_id: personId, updated_at: now });
    }

    const hasManualRow = rows.some((r) => r.source === "manual");
    if (!hasManualRow) {
      await ctx.db.insert("identities", {
        person_id: personId,
        kind,
        value: trimmed,
        normalized,
        network: undefined,
        display_name,
        message_count: 0,
        chat_count: 0,
        is_self: false,
        source: "manual",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    // Recompute rather than hand-set the aggregates: display_name_locked
    // (set above when display_name was provided) protects a typed name from
    // being overwritten; when no name was provided, this derives the best
    // name from whatever identities just got linked (including orphan rows).
    await recomputePersonAggregates(ctx, personId);
    return { created: true as const, personId };
  },
});

/**
 * Explicit "Add Contact from Airtable" — the Contacts screen's search shows
 * Airtable matches below your existing contacts; tapping one calls this.
 * Unlike airtableSync.ts's background cron (link_only, enrich-only), this
 * is a deliberate per-person action, so it's allowed to create a new person
 * when there's no existing match — Milad chose this specific human on
 * purpose, this isn't the cron guessing everyone in a growing community
 * database belongs in his graph.
 */
export const addPersonFromAirtable = mutation({
  args: {
    key: v.string(),
    record_id: v.string(),
    display_name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { key, record_id, display_name, phone, email }) => {
    requireIdentityKey(key);
    const result = await ingestOneCard(
      ctx,
      "airtable_human",
      {
        display_name,
        phones: phone ? [phone] : [],
        emails: email ? [email] : [],
        airtable_record_id: record_id,
      },
      false,
    );
    if (result.outcome === "skipped_no_handles" || result.outcome === "skipped_no_match") {
      // skipped_no_match can't actually happen with link_only=false, but
      // the discriminated union doesn't know that statically.
      throw new Error("Can't add a contact with no phone or email");
    }
    return { personId: result.personId };
  },
});

/**
 * Rename any existing person — the general in-app "edit contact" affordance.
 * Sets display_name_locked so the next Apple/Airtable/Beeper sync doesn't
 * silently revert it back to the longest source-derived identity name (see
 * recomputePersonAggregates in convex/identity/internal.ts).
 */
export const renamePerson = mutation({
  args: { key: v.string(), personId: v.id("people"), display_name: v.string() },
  handler: async (ctx, { key, personId, display_name }) => {
    requireIdentityKey(key);
    const trimmed = display_name.trim();
    if (!trimmed) throw new Error("Name can't be empty");
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");
    const now = new Date().toISOString();
    await ctx.db.patch(personId, {
      display_name: trimmed,
      display_name_locked: true,
      updated_at: now,
    });
  },
});
