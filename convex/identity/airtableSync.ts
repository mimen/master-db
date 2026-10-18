import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internalAction, type ActionCtx } from "../_generated/server";

import { contactValues, readCanonicalSnapshot, type CanonicalContact, type CanonicalSnapshot } from "./canonicalContacts";
import { cleanupPlan, fingerprint, type CleanupPlan } from "./cleanupPlan";

/**
 * Pulls AUF's Airtable "Humans" table into the identity graph, Convex-native
 * (no imsg involvement — unlike Apple Contacts, Airtable has a real cloud
 * API, so this runs the same way convex/todoist/sync does: a scheduled
 * action calling fetch() directly). Cron-driven, full refresh each run —
 * the table is small enough that incremental sync isn't worth the
 * complexity Todoist's sync token approach needs.
 *
 * Deliberately excludes Profile Picture: Airtable attachment URLs are
 * signed and expire, so storing one would rot. imsg already sources photos
 * from Apple Contacts via its own avatar route — nothing reads a photo out
 * of the identity graph, same reasoning as dropping Apple's avatar bytes.
 *
 * link_only: this background sync only ENRICHES people already in the
 * graph (exact phone/email match) — it never creates a new person from an
 * unmatched Humans record. Airtable is a growing community database, most
 * of which Milad has never actually talked to; this cron isn't the place to
 * decide those people belong in his identity graph. Bringing a specific
 * unmatched person in on purpose is airtableSearch.ts's job.
 */

const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const HUMANS_TABLE_ID = "tbl6LptFEMKLaN0I9";
// Contact join keys come from AUF's canonical assignments, including secondary contacts.
const FIELDS = ["Name", "First Name", "Last Name"];

type AirtableRecord = {
  id: string;
  fields: { Name?: string; "First Name"?: string; "Last Name"?: string };
};

type AirtableListResponse = {
  records: AirtableRecord[];
  offset?: string;
};

type ContactCard = {
  display_name?: string;
  // First/Last Name are separate singleLineText columns in Airtable Humans —
  // see convex/schema/identity/identities.ts's docstring: these can be naive
  // or empty even when Name is a good display value (freeform rows like "The
  // Brooklyn Mirage" or "@nataliekowal_" have no real first/last). No
  // nickname/organization column exists in Humans, so those stay unset from
  // this source (Apple Contacts is the only source for nickname; Convex
  // itself is the source for organization).
  first_name?: string;
  last_name?: string;
  phones: string[];
  emails: string[];
  airtable_record_id: string;
};

/** Maps one Humans row to a pre-grouped contact card, or null if it has no handle at all. */
export function toContactCard(r: AirtableRecord, contacts: CanonicalContact[]): ContactCard | null {
  const phones = contactValues(contacts, r.id, "sms");
  const emails = contactValues(contacts, r.id, "email");
  if (phones.length === 0 && emails.length === 0) return null;
  return {
    display_name: r.fields.Name,
    first_name: r.fields["First Name"],
    last_name: r.fields["Last Name"],
    phones,
    emails,
    airtable_record_id: r.id,
  };
}

type SnapshotCard = { humanId: string; canonicalHumanId: string | null; display_name?: string; first_name?: string; last_name?: string; phones: string[]; emails: string[] };
const sourceState = makeFunctionReference<"query", Record<string, never>, { humanIds: string[]; legacyCount: number }>("identity/canonicalReconciliation:sourceState");
const reconcileBatch = makeFunctionReference<"mutation", { cards: SnapshotCard[] }, { peopleReused: number; identitiesWritten: number; identitiesRemoved: number; skippedNoMatch: number; linksUpdated: number }>("identity/canonicalReconciliation:reconcileBatch");
const removeLegacy = makeFunctionReference<"mutation", { plan: CleanupPlan }, { removed: number }>("identity/canonicalReconciliation:removeLegacy");
const cleanupState = makeFunctionReference<"query", Record<string, never>, { fingerprint: string; legacy: CleanupPlan["legacy"] }>("identity/canonicalReconciliation:cleanupState");

async function synchronize(ctx: ActionCtx, migration: "none" | "preview" | "apply", plan?: CleanupPlan) {
    const state = await ctx.runQuery(sourceState, {});
    if (migration === "apply" && !plan) throw new Error("Exact reviewed cleanup plan required");
    const initial = migration !== "none" ? await ctx.runQuery(cleanupState, {}) : undefined;
    if (plan && initial?.fingerprint !== plan.initialFingerprint) throw new Error("Cleanup initial state drift");
    if (migration === "none" && state.legacyCount)
      throw new Error("Legacy Airtable identities require reviewed canonical cleanup before hourly sync");
    const apiKey = process.env.AIRTABLE_API_KEY;
    if (!apiKey) {
      throw new Error("AIRTABLE_API_KEY not configured on this Convex deployment");
    }

    const records = new Map<string, AirtableRecord>();
    const snapshot: CanonicalSnapshot = { contacts: [], resolutions: [] };

    let offset: string | undefined;
    let pages = 0;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      for (const f of FIELDS) params.append("fields[]", f);
      if (offset) params.set("offset", offset);

      const res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${HUMANS_TABLE_ID}?${params.toString()}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!res.ok) {
        throw new Error(`Airtable Humans fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as AirtableListResponse;
      const canonical = await readCanonicalSnapshot(body.records.map((row) => row.id));
      snapshot.contacts.push(...canonical.contacts);
      snapshot.resolutions.push(...canonical.resolutions);
      for (const record of body.records) records.set(record.id, record);
      offset = body.offset;
      pages++;
    } while (offset && pages < 1000); // bounded complete read: up to 100,000 Humans

    if (offset) throw new Error("Airtable Humans exceeded the complete-read page limit");

    const missing = state.humanIds.filter((id) => !records.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const page = await readCanonicalSnapshot(missing.slice(i, i + 100));
      snapshot.contacts.push(...page.contacts);
      snapshot.resolutions.push(...page.resolutions);
    }
    const cards: SnapshotCard[] = snapshot.resolutions.map(({ humanId, canonicalHumanId }) => {
      // A complete Airtable enumeration proves whether the canonical Human still exists.
      const record = canonicalHumanId ? records.get(canonicalHumanId) : undefined;
      const contactCard = record ? toContactCard({ ...record, id: humanId }, snapshot.contacts) : null;
      return { humanId, canonicalHumanId: record ? canonicalHumanId : null,
        display_name: record?.fields.Name, first_name: record?.fields["First Name"], last_name: record?.fields["Last Name"],
        phones: contactCard?.phones ?? [],
        emails: contactCard?.emails ?? [] };
    });
    cards.sort((a, b) => Number(b.humanId !== b.canonicalHumanId) - Number(a.humanId !== a.canonicalHumanId));
    const cardsFingerprint = await fingerprint(cards);
    if (migration === "preview") return { recordsSeen: records.size, legacyWouldRemove: state.legacyCount, humansToReconcile: cards.length, cards, cardsFingerprint, initialFingerprint: initial!.fingerprint, legacy: initial!.legacy };
    if (plan && cardsFingerprint !== plan.cardsFingerprint) throw new Error("Canonical replacement manifest drift");
    const result = { recordsSeen: records.size, peopleReused: 0, identitiesWritten: 0, identitiesRemoved: 0, skippedNoMatch: 0, linksUpdated: 0, legacyRemoved: 0 };
    for (let i = 0; i < cards.length; i += 50) {
      const batch = await ctx.runMutation(reconcileBatch, { cards: cards.slice(i, i + 50) });
      result.peopleReused += batch.peopleReused;
      result.identitiesWritten += batch.identitiesWritten;
      result.identitiesRemoved += batch.identitiesRemoved;
      result.skippedNoMatch += batch.skippedNoMatch;
      result.linksUpdated += batch.linksUpdated;
    }
    if (migration === "apply") {
      const receipt = await ctx.runMutation(removeLegacy, { plan: plan! });
      return { ...result, legacyRemoved: receipt.removed, cleanupReceipt: receipt };
    }
    return result;
}

export const syncAirtableHumans = internalAction({ args: {}, handler: (ctx) => synchronize(ctx, "none") });

/** Separate operator-reviewed existing-data cleanup; preview is the default and does not write. */
export const reconcileLegacyAirtableHumans = internalAction({
  args: { apply: v.optional(v.boolean()), plan: v.optional(cleanupPlan) },
  handler: (ctx, { apply, plan }) => synchronize(ctx, apply ? "apply" : "preview", plan),
});
