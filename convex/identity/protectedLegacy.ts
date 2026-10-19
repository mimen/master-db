import type { CleanupPlan } from "./cleanupPlan";

/** Seven source-owned handles whose AUF removal intent is unproven. */
export const protectedLegacy = new Map<string, string>([
  ["nx725m64v8s45agq6sx2nat6y58b506d", "80ad3c8f8e1f881190b40b5369a038ed67d28d1db7fbdbd5752d96ea573f00eb"],
  ["nx7368415b77gh1559f04k40q98b5f3b", "46385df5dc6731e2b2826bcc1657faaa1c23cc5d69996b8d803443672c3c7e0c"],
  ["nx76hvsw8rpjs4f4pbb2erh67s8b46v3", "9ad94e99435c0ee5e56a3b19946642cde15517cea5aabe92247b9d95717b7322"],
  ["nx77229rpjbf8yk0hw1mkaxe2n8fmpgt", "30724648698b0e0288906cc76ea880618c00267f2f0feb9b53d70eb2d7995d3d"],
  ["nx778n7z782v68bve7dgpc7sc58aych3", "8a5f186edbd1caa9252855ecd1e2b71247df5ef467702d4b88294f868621a323"],
  ["nx77w2esg94xy5trfh9qxj1wpn8f1f7t", "2fef0349150f5dc0a5013baa975bfc6bf77b150a07fe34e5bac38a66829c2e06"],
  ["nx7fkspp0z26bxjae3t26vspr18ay3f2", "43d84cfcc287fd62b565b2afb1d24d03e2fd8fa014614a19582444e4c296e488"],
]);

type Legacy = CleanupPlan["legacy"];

export function approvedProtectedEntries(legacy: Legacy): Legacy {
  return legacy.filter(({ id }) => protectedLegacy.has(id));
}

export function assertProtectedPlan(plan: CleanupPlan): void {
  const expected = approvedProtectedEntries(plan.legacy);
  const actual = plan.protectedLegacy ?? [];
  if (actual.length !== expected.length) throw new Error("Exact protected legacy manifest required");
  const byId = new Map(actual.map(({ id, fingerprint }) => [id, fingerprint]));
  if (byId.size !== actual.length) throw new Error("Duplicate protected legacy ID");
  for (const entry of expected) {
    if (protectedLegacy.get(entry.id) !== entry.fingerprint || byId.get(entry.id) !== entry.fingerprint)
      throw new Error("Protected legacy fingerprint drift");
  }
  if (actual.some(({ id }) => !protectedLegacy.has(id))) throw new Error("Unapproved protected legacy ID");
}

export function unreviewedLegacyCount(legacy: Legacy): number {
  return legacy.filter(({ id, fingerprint }) => protectedLegacy.get(id) !== fingerprint).length;
}
