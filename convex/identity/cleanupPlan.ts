import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";

export const cleanupPlan = v.object({
  initialFingerprint: v.string(), cardsFingerprint: v.string(),
  beforeRemovalFingerprint: v.string(), afterRemovalFingerprint: v.string(),
  replacementFingerprint: v.string(),
  legacy: v.array(v.object({ id: v.id("identities"), fingerprint: v.string() })),
});
export type CleanupPlan = {
  initialFingerprint: string; cardsFingerprint: string; beforeRemovalFingerprint: string;
  afterRemovalFingerprint: string; replacementFingerprint: string;
  legacy: { id: Doc<"identities">["_id"]; fingerprint: string }[];
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
export async function stateProof(state: State) {
  const canonical = state.identities.filter(r => r.source === "airtable_human" && r.source_contact_id);
  const replacements = canonical.map(r => projected(r, true)).sort((a,b) => stable(a).localeCompare(stable(b)));
  const identities = state.identities.map(r => projected(r, r.source === "airtable_human" && Boolean(r.source_contact_id))).sort((a,b) => stable(a).localeCompare(stable(b)));
  const people = state.people.map(r => projected(r, false, true)).sort((a,b) => stable(a).localeCompare(stable(b)));
  const legacy = await Promise.all(state.identities.filter(r => r.source === "airtable_human" && !r.source_contact_id).map(async r => ({ id: r._id, fingerprint: await fingerprint(projected(r, false)) })));
  legacy.sort((a,b) => a.id.localeCompare(b.id));
  return { fingerprint: await fingerprint({ people, identities }), replacementFingerprint: await fingerprint(replacements), legacy, replacements };
}
