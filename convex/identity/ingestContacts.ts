import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

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
const contactCard = v.object({
  display_name: v.optional(v.string()),
  phones: v.array(v.string()),
  emails: v.array(v.string()),
});

export const ingestContactsBatch = internalMutation({
  args: {
    source: v.string(), // "apple_contact" today; same shape works for a future Airtable ingester
    contacts: v.array(contactCard),
  },
  handler: async (ctx, { source, contacts }) => {
    const now = new Date().toISOString();
    let peopleCreated = 0;
    let peopleReused = 0;
    let identitiesWritten = 0;
    let skippedNoHandles = 0;

    for (const card of contacts) {
      const handles: Array<{ value: string; kind: "phone" | "email"; normalized: string }> = [];
      for (const phone of card.phones) {
        if (!phone) continue;
        handles.push({ value: phone, kind: "phone", normalized: normalizePhone(phone) });
      }
      for (const email of card.emails) {
        if (!email) continue;
        handles.push({ value: email, kind: "email", normalized: normalizeEmail(email) });
      }
      if (handles.length === 0) {
        skippedNoHandles++;
        continue;
      }

      // Reuse a person if any of this card's handles already exist under
      // this same source (re-ingest) — checked first so re-syncing a known
      // card doesn't spawn a duplicate person if its cross-source match
      // logic below would otherwise find nothing.
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

      // Otherwise, cross-source link: if any handle's normalized value
      // already belongs to a person from another source (e.g. a Beeper
      // WhatsApp identity), join that person instead of creating a new one.
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
        peopleCreated++;
      } else {
        peopleReused++;
      }

      for (const h of handles) {
        const rows = await ctx.db
          .query("identities")
          .withIndex("by_value", (q) => q.eq("value", h.value))
          .collect();
        const existing = rows.find((r) => r.source === source);
        if (existing) {
          await ctx.db.patch(existing._id, {
            person_id: personId,
            display_name:
              card.display_name && card.display_name.length > (existing.display_name?.length ?? 0)
                ? card.display_name
                : existing.display_name,
            updated_at: now,
          });
        } else {
          await ctx.db.insert("identities", {
            person_id: personId,
            kind: h.kind,
            value: h.value,
            normalized: h.normalized,
            network: undefined,
            display_name: card.display_name,
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

      await recomputePersonAggregates(ctx, personId);
    }

    return { peopleCreated, peopleReused, identitiesWritten, skippedNoHandles };
  },
});
