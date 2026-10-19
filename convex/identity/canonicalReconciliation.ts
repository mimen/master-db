import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

import { cleanupPlan, fingerprint, semanticGuard, semanticStateProof, stateProof } from "./cleanupPlan";
import { ingestOneCard } from "./ingestContacts";
import { personAggregatePatch, recomputePersonAggregates } from "./internal";
import { normalizeEmail, normalizePhone } from "./normalize";
import { assertProtectedPlan, protectedDriftCount, protectedLegacy } from "./protectedLegacy";

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
    const legacy = rows.filter((r) => !r.source_contact_id);
    const protectedDrift = await protectedDriftCount((id) => ctx.db.get(id));
    return { humanIds: [...new Set([...rows.map((r) => r.source_contact_id), ...people.map((p) => p.airtable_human_id)].filter((id): id is string => Boolean(id)))],
      legacyCount: legacy.filter((r) => !protectedLegacy.has(r._id)).length + protectedDrift };
  },
});

export const reconcileBatch = internalMutation({
  args: { cards: v.array(snapshotCard) },
  returns: v.object({ peopleReused: v.number(), identitiesWritten: v.number(), identitiesRemoved: v.number(), skippedNoMatch: v.number(), linksUpdated: v.number() }),
  handler: async (ctx, { cards }) => {
    if (cards.length > 50) throw new Error("Canonical reconciliation batch exceeds 50 Humans");
    if (await protectedDriftCount((id) => ctx.db.get(id))) throw new Error("Protected legacy identity drift");
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

// Final deletion is one atomic transaction, bound to the approved local replay.
export const cleanupState = internalQuery({
  args: { semanticGuard: v.optional(semanticGuard) },
  handler: async (ctx, { semanticGuard: guard }) => {
    const state = { people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() };
    const proof = await stateProof(state);
    return { ...proof, semanticFingerprint: guard ? (await semanticStateProof(state, guard)).fingerprint : undefined };
  },
});
export const removeLegacy = internalMutation({
  args: { plan: cleanupPlan },
  handler: async (ctx, { plan }) => {
    assertProtectedPlan(plan);
    const state = { people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() };
    const before = await stateProof(state);
    const semanticBefore = plan.semanticGuard ? await semanticStateProof(state, plan.semanticGuard) : undefined;
    const legacyIds = before.legacy.map(({ id }) => id);
    if ((plan.semanticGuard
          ? semanticBefore!.fingerprint !== plan.semanticGuard.beforeRemovalFingerprint ||
            semanticBefore!.legacyFingerprint !== plan.semanticGuard.legacyFingerprint ||
            legacyIds.length !== plan.legacy.length || legacyIds.some((id, index) => id !== plan.legacy[index].id)
          : before.fingerprint !== plan.beforeRemovalFingerprint || await fingerprint(before.legacy) !== await fingerprint(plan.legacy)) ||
        before.replacementFingerprint !== plan.replacementFingerprint) throw new Error("Cleanup plan drift or unverified replacements");
    const affected = new Set<Id<"people">>();
    // No rescan-and-delete: only the immutable approved IDs can be retired.
    const protectedIds = new Set((plan.protectedLegacy ?? []).map(({ id }) => id));
    for (const entry of plan.legacy.filter(({ id }) => !protectedIds.has(id))) {
      const row = state.identities.find(r => r._id === entry.id);
      if (!row || row.source !== "airtable_human" || row.source_contact_id) throw new Error("Cleanup legacy scope changed");
      await ctx.db.delete(entry.id);
      if (row.person_id) affected.add(row.person_id);
    }
    const removed = new Set(plan.legacy.filter(({ id }) => !protectedIds.has(id)).map(r => r.id));
    const remaining = state.identities.filter(r => !removed.has(r._id));
    const people = [];
    for (const person of state.people) {
      const patch = affected.has(person._id) ? personAggregatePatch(person, remaining.filter(r => r.person_id === person._id)) : null;
      if (patch) await ctx.db.patch(person._id, patch);
      people.push(patch ? { ...person, ...patch } : person);
    }
    const after = await stateProof({ people, identities: remaining });
    const semanticAfter = plan.semanticGuard ? await semanticStateProof({ people, identities: remaining }, plan.semanticGuard) : undefined;
    if (plan.semanticGuard
      ? semanticAfter!.fingerprint !== plan.semanticGuard.afterRemovalFingerprint
      : after.fingerprint !== plan.afterRemovalFingerprint) throw new Error("Cleanup after-state does not match reviewed plan");
    return { removed: removed.size, beforeFingerprint: before.fingerprint, afterFingerprint: after.fingerprint,
      replacementFingerprint: before.replacementFingerprint, legacy: plan.legacy.filter(({ id }) => removed.has(id)),
      semanticBeforeFingerprint: semanticBefore?.fingerprint, semanticAfterFingerprint: semanticAfter?.fingerprint };
  },
});
