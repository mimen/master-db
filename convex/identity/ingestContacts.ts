import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

import { recomputePersonAggregates } from "./internal";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * Ingest for any source that natively groups multiple handles into one
 * record (an Apple Contacts card, an Airtable Human row with several phone
 * fields). Unlike upsertIdentitiesBatch/assignCluster in internal.ts — which
 * treat every handle as an independent candidate and rely on the
 * normalized-key resolver to notice two handles belong together — this
 * trusts the source record's own grouping: every phone/email on one card is
 * attached to the SAME person at ingest time, no clustering pass needed.
 *
 * This is what lets a person with a mobile number AND a home number (which
 * don't share a normalized key with each other) still end up as one person
 * instead of two. resolveIdentities keeps running for CROSS-source linking
 * only — e.g. matching one of these phones against a Beeper WhatsApp identity
 * that happens to normalize the same.
 *
 * Idempotent: re-ingesting the same card updates its identities in place
 * (dedupe key is (value, source)) rather than duplicating rows. No
 * source_record_id/provenance tracking in this phase — a card that drops a
 * phone number leaves the stale identity in place; cleanup is deferred.
 */

// No img_url: raw contact-photo bytes can alone exceed Convex's 1MiB
// per-document cap (hit in practice — see identity-sync.ts's toContactCard
// docstring in the imsg repo for the full story). Photos stay out of the
// identity graph; imsg already serves them via its own avatar route.
// (Airtable attachment URLs have the same "don't store this" problem for a
// different reason — they're signed and expire, so a stored URL rots.)
const contactCard = v.object({
  display_name: v.optional(v.string()),
  // Structured name parts, as the source presents them — see
  // convex/schema/identity/identities.ts's docstring for how these relate to
  // display_name. Apple sends first_name/last_name/nickname/source_contact_id;
  // Airtable sends first_name/last_name only (no nickname/org column).
  first_name: v.optional(v.string()),
  last_name: v.optional(v.string()),
  nickname: v.optional(v.string()),
  // The source's own contact-record id (e.g. Apple's "UUID:ABPerson"),
  // retained for a future Apple write-back — see identities.source_contact_id.
  source_contact_id: v.optional(v.string()),
  phones: v.array(v.string()),
  emails: v.array(v.string()),
  // The source's own record id (e.g. an Airtable "rec..." id). When present,
  // patched onto the person as airtable_human_id for the person-view deep
  // link out. Source-specific by design — only Airtable has this today.
  airtable_record_id: v.optional(v.string()),
});

export type ContactCard = {
  display_name?: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  source_contact_id?: string;
  phones: string[];
  emails: string[];
  airtable_record_id?: string;
};

export type IngestCardResult =
  | { outcome: "skipped_no_handles" }
  | { outcome: "skipped_no_match" }
  | { outcome: "created"; personId: Id<"people">; identitiesWritten: number }
  | { outcome: "reused"; personId: Id<"people">; identitiesWritten: number };

/**
 * Ingest one pre-grouped card. Shared by ingestContactsBatch (the background
 * sync loop) and addPersonFromAirtable (the explicit "Add Contact" action) —
 * same merge rules either way, only whether an unmatched card creates a new
 * person differs (link_only).
 */
export async function ingestOneCard(
  ctx: MutationCtx,
  source: string,
  card: ContactCard,
  link_only: boolean,
): Promise<IngestCardResult> {
  const now = new Date().toISOString();
  const handles: Array<{ value: string; kind: "phone" | "email"; normalized: string }> = [];
  for (const phone of card.phones) {
    if (!phone) continue;
    handles.push({ value: phone, kind: "phone", normalized: normalizePhone(phone) });
  }
  for (const email of card.emails) {
    if (!email) continue;
    handles.push({ value: email, kind: "email", normalized: normalizeEmail(email) });
  }
  if (handles.length === 0) return { outcome: "skipped_no_handles" };

  // Reuse a person if any of this card's handles already exist under this
  // same source (re-ingest) — checked first so re-syncing a known card
  // doesn't spawn a duplicate person if its cross-source match logic below
  // would otherwise find nothing.
  let personId: Id<"people"> | null = null;
  for (const h of handles) {
    const rows = await ctx.db
      .query("identities")
      .withIndex("by_value", (q) => q.eq("value", h.value))
      .collect();
    const sameSource = rows.find((r) => r.source === source);
    if (sameSource?.person_id) {
      const p = await ctx.db.get(sameSource.person_id);
      if (p && !p.merged_into) {
        personId = sameSource.person_id;
        break;
      }
    }
  }

  // Otherwise, cross-source link: if any handle's normalized value already
  // belongs to a person from another source (e.g. a Beeper WhatsApp
  // identity), join that person instead of creating a new one.
  if (!personId) {
    for (const h of handles) {
      if (!h.normalized) continue;
      const match = await ctx.db
        .query("identities")
        .withIndex("by_normalized", (q) => q.eq("normalized", h.normalized))
        .first();
      if (match?.person_id) {
        const p = await ctx.db.get(match.person_id);
        if (p && !p.merged_into) {
          personId = match.person_id;
          break;
        }
      }
    }
  }

  const wasReused = personId !== null;
  if (!personId && link_only) return { outcome: "skipped_no_match" };

  if (!personId) {
    personId = await ctx.db.insert("people", {
      display_name: undefined,
      normalized_phones: [],
      normalized_emails: [],
      identity_count: 0,
      message_count: 0,
      is_self: false,
      auto_clustered: true,
      created_at: now,
      updated_at: now,
    });
  }

  let identitiesWritten = 0;
  for (const h of handles) {
    const rows = await ctx.db
      .query("identities")
      .withIndex("by_value", (q) => q.eq("value", h.value))
      .collect();
    const existing = rows.find((r) => r.source === source);
    if (existing) {
      const nextDisplayName =
        card.display_name && card.display_name.length > (existing.display_name?.length ?? 0)
          ? card.display_name
          : existing.display_name;
      // first_name/last_name/nickname/source_contact_id use "new non-blank
      // value wins, blank never clears" — unlike display_name's growth-merge
      // (which favors length as a proxy for completeness), these are single
      // structured fields from one source record, so a fresh non-empty value
      // is always the more current truth; a card that transiently omits one
      // (e.g. a naive Airtable split) must not blow away a good existing
      // value.
      const nextFirstName = card.first_name || existing.first_name;
      const nextLastName = card.last_name || existing.last_name;
      const nextNickname = card.nickname || existing.nickname;
      const nextSourceContactId = card.source_contact_id || existing.source_contact_id;
      // Only write when something actually differs. This is the ~1,510-card
      // sync loop that runs every 10 minutes — patching (and bumping
      // updated_at) on every re-ingest of an unchanged card would rewrite
      // every identity every cycle and invalidate every reactive query
      // subscribed to it for no reason.
      const changed =
        existing.person_id !== personId ||
        existing.display_name !== nextDisplayName ||
        existing.first_name !== nextFirstName ||
        existing.last_name !== nextLastName ||
        existing.nickname !== nextNickname ||
        existing.source_contact_id !== nextSourceContactId;
      if (changed) {
        await ctx.db.patch(existing._id, {
          person_id: personId,
          display_name: nextDisplayName,
          first_name: nextFirstName,
          last_name: nextLastName,
          nickname: nextNickname,
          source_contact_id: nextSourceContactId,
          updated_at: now,
        });
      }
    } else {
      await ctx.db.insert("identities", {
        person_id: personId,
        kind: h.kind,
        value: h.value,
        normalized: h.normalized,
        network: undefined,
        display_name: card.display_name,
        first_name: card.first_name,
        last_name: card.last_name,
        nickname: card.nickname,
        source_contact_id: card.source_contact_id,
        message_count: 0,
        chat_count: 0,
        is_self: false,
        source,
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      });
    }
    identitiesWritten++;
  }

  if (card.airtable_record_id) {
    const p = await ctx.db.get(personId);
    if (p && !p.airtable_human_id) {
      await ctx.db.patch(personId, { airtable_human_id: card.airtable_record_id, updated_at: now });
    }
  }

  await recomputePersonAggregates(ctx, personId);
  return wasReused
    ? { outcome: "reused", personId, identitiesWritten }
    : { outcome: "created", personId, identitiesWritten };
}

export const ingestContactsBatch = internalMutation({
  args: {
    source: v.string(), // "apple_contact" today; same shape works for a future Airtable ingester
    contacts: v.array(contactCard),
    // When true, a card that matches no existing person (same-source reuse
    // or cross-source normalized match) is skipped entirely rather than
    // creating a new one. Used by the Airtable sync: Milad wants Airtable to
    // enrich people he already has, not seed the graph with everyone in a
    // growing community database he's never actually talked to.
    link_only: v.optional(v.boolean()),
  },
  handler: async (ctx, { source, contacts, link_only }) => {
    let peopleCreated = 0;
    let peopleReused = 0;
    let identitiesWritten = 0;
    let skippedNoHandles = 0;
    let skippedNoMatch = 0;

    for (const card of contacts) {
      const result = await ingestOneCard(ctx, source, card, link_only ?? false);
      switch (result.outcome) {
        case "skipped_no_handles":
          skippedNoHandles++;
          break;
        case "skipped_no_match":
          skippedNoMatch++;
          break;
        case "created":
          peopleCreated++;
          identitiesWritten += result.identitiesWritten;
          break;
        case "reused":
          peopleReused++;
          identitiesWritten += result.identitiesWritten;
          break;
      }
    }

    return { peopleCreated, peopleReused, identitiesWritten, skippedNoHandles, skippedNoMatch };
  },
});
