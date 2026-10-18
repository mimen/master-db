import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

import { ingestOneCard } from "./ingestContacts";
import { recomputePersonAggregates } from "./internal";
import { normalizeEmail, normalizePhone } from "./normalize";

export const snapshotCard = v.object({
  humanId: v.string(),
  canonicalHumanId: v.union(v.string(), v.null()),
  display_name: v.optional(v.string()), first_name: v.optional(v.string()), last_name: v.optional(v.string()),
  phones: v.array(v.string()), emails: v.array(v.string()),
});

export const sourceState = internalQuery({
  args: {},
  returns: v.object({ humanIds: v.array(v.string()), legacyCount: v.number() }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("identities").withIndex("by_source_contact", (q) => q.eq("source", "airtable_human")).collect();
    const people = await ctx.db.query("people").collect();
    return { humanIds: [...new Set([...rows.map((r) => r.source_contact_id), ...people.map((p) => p.airtable_human_id)].filter((id): id is string => Boolean(id)))],
      legacyCount: rows.filter((r) => !r.source_contact_id).length };
  },
});

export const reconcileBatch = internalMutation({
  args: { cards: v.array(snapshotCard) },
  returns: v.object({ peopleReused: v.number(), identitiesWritten: v.number(), identitiesRemoved: v.number(), skippedNoMatch: v.number(), linksUpdated: v.number() }),
  handler: async (ctx, { cards }) => {
    if (cards.length > 50) throw new Error("Canonical reconciliation batch exceeds 50 Humans");
    const result = { peopleReused: 0, identitiesWritten: 0, identitiesRemoved: 0, skippedNoMatch: 0, linksUpdated: 0 };
    const affected = new Set<Id<"people">>();
    for (const card of cards) {
      const prior = await ctx.db.query("identities").withIndex("by_source_contact", (q) => q.eq("source", "airtable_human").eq("source_contact_id", card.humanId)).collect();
      // Only the endpoint's verified resolution (or a complete Airtable absence) moves a link.
      if (card.canonicalHumanId !== card.humanId) {
        const linked = await ctx.db.query("people").withIndex("by_airtable_human", (q) => q.eq("airtable_human_id", card.humanId)).collect();
        for (const person of linked) {
          await ctx.db.patch(person._id, { airtable_human_id: card.canonicalHumanId ?? undefined });
          result.linksUpdated++;
        }
      }
      if (card.canonicalHumanId) {
        const ingested = await ingestOneCard(ctx, "airtable_human", { ...card,
          source_contact_id: card.canonicalHumanId, airtable_record_id: card.canonicalHumanId }, true);
        if (ingested.outcome === "reused") {
          result.peopleReused++;
          result.identitiesWritten += ingested.identitiesWritten;
        } else if (ingested.outcome === "skipped_no_match") result.skippedNoMatch++;
      }
      const keys = new Set([...card.phones.map((value) => `phone:${normalizePhone(value)}`), ...card.emails.map((value) => `email:${normalizeEmail(value)}`)]);
      for (const row of prior) {
        if (card.canonicalHumanId === card.humanId && keys.has(`${row.kind}:${row.normalized}`)) continue;
        await ctx.db.delete(row._id);
        if (row.person_id) affected.add(row.person_id);
        result.identitiesRemoved++;
      }
    }
    for (const personId of affected) await recomputePersonAggregates(ctx, personId);
    return result;
  },
});

// Called only by the explicit migration action after all reads and replacement batches succeed.
export const removeLegacy = internalMutation({
  args: {}, returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("identities").withIndex("by_source_contact", (q) => q.eq("source", "airtable_human").eq("source_contact_id", undefined)).collect();
    const affected = new Set<Id<"people">>();
    for (const row of rows) {
      await ctx.db.delete(row._id);
      if (row.person_id) affected.add(row.person_id);
    }
    for (const id of affected) await recomputePersonAggregates(ctx, id);
    return rows.length;
  },
});
