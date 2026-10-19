import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";

import { personAggregatePatch } from "./internal";
import { normalizeEmail, normalizePhone } from "./normalize";

export const semanticGuard = v.object({
  scope: v.optional(v.literal("touched")),
  touchedPersonIds: v.optional(v.array(v.id("people"))),
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
  batchPrewriteFingerprints: v.optional(v.array(v.string())),
  batchPostwriteFingerprints: v.optional(v.array(v.string())),
});
export type SemanticGuard = {
  scope?: "touched";
  touchedPersonIds?: Doc<"people">["_id"][];
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
  batchPrewriteFingerprints?: string[];
  batchPostwriteFingerprints?: string[];
};
export type State = { people: Doc<"people">[]; identities: Doc<"identities">[] };
function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sortStable<T>(values: T[]): T[] {
  return values.map(value => ({ value, key: stable(value) }))
    .sort((a,b) => a.key.localeCompare(b.key)).map(({ value }) => value);
}
async function fingerprintText(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export async function fingerprint(value: unknown): Promise<string> {
  return fingerprintText(stable(value));
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
  const replacements = sortStable(canonical.map(r => projected(r, true)));
  const identities = sortStable(state.identities.map(r => projected(r, r.source === "airtable_human" && Boolean(r.source_contact_id))));
  const people = sortStable(state.people.map(r => projected(r, false, true)));
  const legacy = await Promise.all(state.identities.filter(r => r.source === "airtable_human" && !r.source_contact_id).map(async r => ({ id: r._id, fingerprint: await legacyRowFingerprint(r) })));
  legacy.sort((a,b) => a.id.localeCompare(b.id));
  return { fingerprint: await fingerprint({ people, identities }), replacementFingerprint: await fingerprint(replacements), legacy, replacements };
}

/** Fingerprint every semantic field while permitting only the reviewed transient fields. */
type MatchCard = { humanId: string; canonicalHumanId: string | null; phones: string[]; emails: string[] };

function touchedProofRows(state: State, guard: SemanticGuard, cards: MatchCard[]) {
  const ownerRows = new Map(guard.legacyOwnerRows.map(({ id, allowedPersonIds }) => [id, new Set(allowedPersonIds)]));
  const legacy = state.identities.filter(row => row.source === "airtable_human" && !row.source_contact_id)
    .map(row => {
      const projectedRow = projected(row, false);
      if (ownerRows.has(row._id)) {
        if (!row.person_id || !ownerRows.get(row._id)!.has(row.person_id)) throw new Error("Legacy owner outside reviewed set");
        delete projectedRow.person_id;
        delete projectedRow.updated_at;
      }
      return { id: row._id, row: projectedRow };
    }).sort((a,b) => a.id.localeCompare(b.id));
  const canonical = state.identities.filter(row => row.source === "airtable_human" && row.source_contact_id)
    .map(row => ({ source: row.source, source_contact_id: row.source_contact_id,
      person_id: row.person_id, kind: row.kind, value: row.value,
      normalized: row.normalized, display_name: row.display_name,
      first_name: row.first_name, last_name: row.last_name, nickname: row.nickname,
      network: row.network }));
  const touched = new Set(guard.touchedPersonIds ?? []);
  for (const row of state.identities) if (row.source === "airtable_human" && row.person_id) touched.add(row.person_id);
  for (const row of state.people) if (row.airtable_human_id) touched.add(row._id);
  const people = state.people.filter(row => touched.has(row._id)).map(row => ({
    id: row._id, airtable_human_id: row.airtable_human_id, merged_into: row.merged_into,
  }));

  // The batch input includes only rows the card lookup can consult: every exact
  // value candidate and the first row in each normalized index range. A new
  // collision, provenance change, or owner merge therefore changes the atomic
  // proof even when an unrelated source row is otherwise outside the cleanup.
  const values = new Set(cards.flatMap(card => [...card.phones, ...card.emails]).filter(Boolean));
  const normalized = new Set(cards.flatMap(card => [
    ...card.phones.map(normalizePhone), ...card.emails.map(normalizeEmail),
  ]).filter(Boolean));
  const exact = state.identities.filter(row => values.has(row.value));
  const firstByNormalized = new Map<string, Doc<"identities">>();
  for (const row of state.identities) {
    if (!normalized.has(row.normalized)) continue;
    const old = firstByNormalized.get(row.normalized);
    if (!old || row._creationTime < old._creationTime ||
        (row._creationTime === old._creationTime && row._id < old._id)) firstByNormalized.set(row.normalized, row);
  }
  // Airtable rows are already covered by the full legacy and canonical
  // projections. Generated canonical IDs differ between replay and live.
  const candidateRows = [...new Map([...exact, ...firstByNormalized.values()]
    .filter(row => row.source !== "airtable_human").map(row => [row._id, row])).values()];
  const candidatePeople = new Set(candidateRows.map(row => row.person_id).filter((id): id is Doc<"people">["_id"] => Boolean(id)));
  const linkedIds = new Set(cards.flatMap(card => [card.humanId, card.canonicalHumanId].filter((id): id is string => Boolean(id))));
  const linked = state.people.filter(row => row.airtable_human_id && linkedIds.has(row.airtable_human_id));
  for (const row of linked) candidatePeople.add(row._id);
  const candidates = candidateRows.map(row => ({
    id: row._id, created: row._creationTime, value: row.value,
    normalized: row.normalized,
    person_id: ownerRows.has(row._id) ? undefined : row.person_id,
  }));
  const owners = state.people.filter(row => candidatePeople.has(row._id)).map(row => ({
    id: row._id, merged_into: row.merged_into,
  }));
  return { legacy, canonical, people, candidates, owners, linked: linked.map(row => row._id) };
}

export async function semanticStateProof(state: State, guard: SemanticGuard, cards: MatchCard[] = []) {
  if (guard.scope === "touched") {
    const rows = touchedProofRows(state, guard, cards);
    const legacyText = sortStable(rows.legacy).map(stable).join(",");
    return {
      fingerprint: await fingerprint({ legacy: rows.legacy, canonical: sortStable(rows.canonical),
        people: sortStable(rows.people), candidates: sortStable(rows.candidates),
        owners: sortStable(rows.owners), linked: [...rows.linked].sort() }),
      legacyFingerprint: await fingerprintText(`[${legacyText}]`),
    };
  }
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
  });
  const people = state.people.map((row) => {
    const projectedRow = projected(row, false, true);
    if (derivedPeople.has(row._id)) {
      if (personAggregatePatch(row, ownedIdentities.get(row._id) ?? [])) throw new Error("Derived person aggregates are not current");
      delete projectedRow.identity_count;
      delete projectedRow.normalized_emails;
    }
    return projectedRow;
  });
  const legacy = state.identities.filter(row => row.source === "airtable_human" && !row.source_contact_id)
    .map(row => {
      const projectedRow = projected(row, false);
      if (ownerRows.has(row._id)) { delete projectedRow.person_id; delete projectedRow.updated_at; }
      return { id: row._id, row: projectedRow };
    }).sort((a,b) => a.id.localeCompare(b.id));
  const identityText = identities.map(stable).sort((a,b) => a.localeCompare(b)).join(",");
  const peopleText = people.map(stable).sort((a,b) => a.localeCompare(b)).join(",");
  const legacyText = legacy.map(stable).join(",");
  return {
    fingerprint: await fingerprintText(`{"identities":[${identityText}],"people":[${peopleText}]}`),
    legacyFingerprint: await fingerprintText(`[${legacyText}]`),
  };
}
