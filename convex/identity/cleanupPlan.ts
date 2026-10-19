import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";

import { personAggregatePatch } from "./internal";

export const semanticGuard = v.object({
  allowAppleUpdatedAt: v.boolean(),
  legacyOwnerRows: v.array(v.object({ id: v.id("identities"), allowedPersonIds: v.array(v.id("people")) })),
  derivedPeople: v.array(v.id("people")),
  initialFingerprint: v.string(), beforeRemovalFingerprint: v.string(), afterRemovalFingerprint: v.string(),
  legacyFingerprint: v.string(),
});
export const cleanupPlan = v.object({
  initialFingerprint: v.string(), cardsFingerprint: v.string(),
  beforeRemovalFingerprint: v.string(), afterRemovalFingerprint: v.string(),
  replacementFingerprint: v.string(),
  legacy: v.array(v.object({ id: v.id("identities"), fingerprint: v.string() })),
  protectedLegacy: v.optional(v.array(v.object({ id: v.id("identities"), fingerprint: v.string() }))),
  semanticGuard: v.optional(semanticGuard),
});
export type SemanticGuard = {
  allowAppleUpdatedAt: boolean;
  legacyOwnerRows: { id: Doc<"identities">["_id"]; allowedPersonIds: Doc<"people">["_id"][] }[];
  derivedPeople: Doc<"people">["_id"][];
  initialFingerprint: string; beforeRemovalFingerprint: string; afterRemovalFingerprint: string;
  legacyFingerprint: string;
};
export type CleanupPlan = {
  initialFingerprint: string; cardsFingerprint: string; beforeRemovalFingerprint: string;
  afterRemovalFingerprint: string; replacementFingerprint: string;
  legacy: { id: Doc<"identities">["_id"]; fingerprint: string }[];
  protectedLegacy?: { id: Doc<"identities">["_id"]; fingerprint: string }[];
  semanticGuard?: SemanticGuard;
};
export type State = { people: Doc<"people">[]; identities: Doc<"identities">[] };
function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
// Generated row IDs and wall-clock fields cannot be predicted offline. All identity
// ownership/contact/name fields and person links/aggregates remain fingerprinted.
function projected(row: Record<string, unknown>, generated: boolean, person = false) {
  const copy = { ...row };
  delete copy._creationTime;
  if (generated) for (const k of ["_id", "created_at", "updated_at", "first_seen_at", "last_seen_at"]) delete copy[k];
  if (person) { delete copy.updated_at; delete copy.photoStorageId; }
  return copy;
}
export async function legacyRowFingerprint(row: Doc<"identities">): Promise<string> {
  return fingerprint(projected(row, false));
}
export async function stateProof(state: State) {
  const canonical = state.identities.filter(r => r.source === "airtable_human" && r.source_contact_id);
  const replacements = canonical.map(r => projected(r, true)).sort((a,b) => stable(a).localeCompare(stable(b)));
  const identities = state.identities.map(r => projected(r, r.source === "airtable_human" && Boolean(r.source_contact_id))).sort((a,b) => stable(a).localeCompare(stable(b)));
  const people = state.people.map(r => projected(r, false, true)).sort((a,b) => stable(a).localeCompare(stable(b)));
  const legacy = await Promise.all(state.identities.filter(r => r.source === "airtable_human" && !r.source_contact_id).map(async r => ({ id: r._id, fingerprint: await legacyRowFingerprint(r) })));
  legacy.sort((a,b) => a.id.localeCompare(b.id));
  return { fingerprint: await fingerprint({ people, identities }), replacementFingerprint: await fingerprint(replacements), legacy, replacements };
}

/** Fingerprint every semantic field while permitting only the reviewed transient fields. */
export async function semanticStateProof(state: State, guard: SemanticGuard) {
  const ownerRows = new Map(guard.legacyOwnerRows.map(({ id, allowedPersonIds }) => [id, new Set(allowedPersonIds)]));
  const derivedPeople = new Set(guard.derivedPeople);
  const ownedIdentities = new Map<Doc<"people">["_id"], Doc<"identities">[]>();
  for (const row of state.identities) {
    if (!row.person_id) continue;
    const owned = ownedIdentities.get(row.person_id) ?? [];
    owned.push(row);
    ownedIdentities.set(row.person_id, owned);
  }
  const identities = state.identities.map((row) => {
    const projectedRow = projected(row, row.source === "airtable_human" && Boolean(row.source_contact_id));
    if (guard.allowAppleUpdatedAt && row.source === "apple_contact") delete projectedRow.updated_at;
    if (ownerRows.has(row._id) && row.source === "airtable_human" && !row.source_contact_id) {
      if (!row.person_id || !ownerRows.get(row._id)!.has(row.person_id)) throw new Error("Legacy owner outside reviewed set");
      delete projectedRow.person_id;
      delete projectedRow.updated_at;
    }
    return projectedRow;
  }).sort((a,b) => stable(a).localeCompare(stable(b)));
  const people = state.people.map((row) => {
    const projectedRow = projected(row, false, true);
    if (derivedPeople.has(row._id)) {
      if (personAggregatePatch(row, ownedIdentities.get(row._id) ?? [])) throw new Error("Derived person aggregates are not current");
      delete projectedRow.identity_count;
      delete projectedRow.normalized_emails;
    }
    return projectedRow;
  }).sort((a,b) => stable(a).localeCompare(stable(b)));
  const legacy = state.identities.filter(row => row.source === "airtable_human" && !row.source_contact_id)
    .map(row => {
      const projectedRow = projected(row, false);
      if (ownerRows.has(row._id)) { delete projectedRow.person_id; delete projectedRow.updated_at; }
      return { id: row._id, row: projectedRow };
    }).sort((a,b) => a.id.localeCompare(b.id));
  return { fingerprint: await fingerprint({ people, identities }), legacyFingerprint: await fingerprint(legacy) };
}
