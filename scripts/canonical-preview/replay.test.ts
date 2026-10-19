import { readFileSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { test, vi, expect } from "vitest";

import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { CanonicalSnapshot } from "../../convex/identity/canonicalContacts";
import { reconcileBatch } from "../../convex/identity/canonicalReconciliation";
import { semanticStateProof, stateProof, type CleanupPlan, type SemanticGuard, type State } from "../../convex/identity/cleanupPlan";
import { recomputePersonAggregates } from "../../convex/identity/internal";
import { protectedLegacy } from "../../convex/identity/protectedLegacy";
import schema from "../../convex/schema";
import { normalizeModules } from "../../convex/test-utils.vitest";

const modules = normalizeModules(import.meta.glob("../../convex/**/*.*s"), import.meta.url);
type RecordRow = { id: string; fields: Record<string, string> };
type Input = { people: Doc<"people">[]; identities: Doc<"identities">[]; records: RecordRow[]; canonical: CanonicalSnapshot; complete: boolean };
const key = (r: Doc<"identities">) => `${r.kind}:${r.normalized}`;
const sorted = (xs: string[]) => [...new Set(xs)].sort();
const save = (path: string, value: unknown) => { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }); chmodSync(path, 0o600); };

async function stampGuard(scope: SemanticGuard, initial: State, replaced: State, after: State): Promise<SemanticGuard> {
  const first = await semanticStateProof(initial, scope);
  const second = await semanticStateProof(replaced, scope);
  const third = await semanticStateProof(after, scope);
  return { ...scope, initialFingerprint: first.fingerprint, beforeRemovalFingerprint: second.fingerprint,
    afterRemovalFingerprint: third.fingerprint, legacyFingerprint: second.legacyFingerprint };
}

async function replay(input: Input) {
  if (!input.complete) throw new Error("Complete input required");
  const t = convexTest(schema, modules);
  const ids = new Map<string, Id<"people">>();
  const oldIdentityIds = new Map<string, Id<"identities">>();
  await t.run(async (ctx) => {
    for (const row of input.people) {
      const { _id, _creationTime, merged_into, not_duplicate_of, photoStorageId, ...data } = row;
      void _creationTime; void merged_into; void not_duplicate_of; void photoStorageId;
      ids.set(_id, await ctx.db.insert("people", data));
    }
    for (const row of input.people) {
      if (row.merged_into && !ids.has(row.merged_into)) throw new Error("Missing merged person");
      await ctx.db.patch(ids.get(row._id)!, { merged_into: row.merged_into ? ids.get(row.merged_into) : undefined,
        not_duplicate_of: row.not_duplicate_of?.map(id => { if (!ids.has(id)) throw new Error("Missing referenced person"); return ids.get(id)!; }) });
    }
    for (const row of input.identities) {
      const { _id, _creationTime, person_id, ...data } = row; void _creationTime;
      if (person_id && !ids.has(person_id)) throw new Error("Missing identity owner");
      oldIdentityIds.set(_id, await ctx.db.insert("identities", { ...data, person_id: person_id ? ids.get(person_id) : undefined }));
    }
  });
  const before = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
  vi.stubEnv("AIRTABLE_API_KEY", "offline-only");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "offline-only");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://offline.convex.site/canonical-contacts/read");
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.origin === "https://api.airtable.com" && u.pathname === "/v0/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9" && (!init?.method || init.method === "GET")) {
      const start = Number(u.searchParams.get("offset") ?? 0);
      return Response.json({ records: input.records.slice(start, start + 100), ...(start + 100 < input.records.length ? { offset: String(start + 100) } : {}) });
    }
    if (u.href === "https://offline.convex.site/canonical-contacts/read" && init?.method === "POST") {
      const requested = new Set<string>(JSON.parse(String(init.body)).humanIds);
      return Response.json({ contacts: input.canonical.contacts.filter(r => requested.has(r.humanId)), resolutions: input.canonical.resolutions.filter(r => requested.has(r.humanId)) });
    }
    throw new Error("NETWORK DENIED: offline replay only");
  });
  const originalPeople = new Map([...ids].map(([a,b]) => [b,a]));
  const originalIdentities = new Map([...oldIdentityIds].map(([a,b]) => [b,a]));
  const originalProtected = new Map(protectedLegacy);
  const protectedGenerated = new Set(
    [...oldIdentityIds].filter(([original]) => originalProtected.has(original)).map(([, generated]) => generated),
  );
  const semanticScope = process.env.CANONICAL_PREVIEW_SEMANTIC_SCOPE
    ? JSON.parse(readFileSync(process.env.CANONICAL_PREVIEW_SEMANTIC_SCOPE, "utf8")) as SemanticGuard : undefined;
  if (semanticScope?.scope === "touched") {
    semanticScope.touchedPersonIds = before.people.filter(person => person.airtable_human_id ||
      before.identities.some(row => row.source === "airtable_human" && row.person_id === person._id))
      .map(person => originalPeople.get(person._id) as Id<"people">);
  }
  const generatedScope = semanticScope ? {
    ...semanticScope,
    legacyOwnerRows: semanticScope.legacyOwnerRows.map(({ id, allowedPersonIds }) => ({
      id: oldIdentityIds.get(id) ?? (() => { throw new Error("Unknown reviewed legacy owner ID"); })(),
      allowedPersonIds: allowedPersonIds.map(personId => ids.get(personId) ?? (() => { throw new Error("Unknown reviewed person ID"); })()),
    })),
    derivedPeople: semanticScope.derivedPeople.map(personId => ids.get(personId) ?? (() => { throw new Error("Unknown derived person ID"); })()),
    touchedPersonIds: semanticScope.touchedPersonIds?.map(personId => ids.get(personId) ?? (() => { throw new Error("Unknown touched person ID"); })()),
  } : undefined;
  const originalize = (state: State): State => ({
    people: state.people.map(p => ({ ...p, _id: originalPeople.get(p._id) as Id<"people">,
      merged_into: p.merged_into ? originalPeople.get(p.merged_into) as Id<"people"> : undefined,
      not_duplicate_of: p.not_duplicate_of?.map(id => originalPeople.get(id) as Id<"people">) })),
    identities: state.identities.map(r => ({ ...r, _id: (originalIdentities.get(r._id) ?? r._id) as Id<"identities">,
      person_id: r.person_id ? originalPeople.get(r.person_id) as Id<"people"> : undefined })),
  });
  let result: unknown; let reviewedPlan: CleanupPlan | undefined;
  const batchMutationDurationsMs: number[] = [];
  try {
    const seededLegacy = new Map((await stateProof(before)).legacy.map(({ id, fingerprint }) => [id, fingerprint]));
    protectedLegacy.clear();
    for (const id of protectedGenerated) {
      const fingerprint = seededLegacy.get(id);
      if (!fingerprint) throw new Error("Protected identity missing from offline seed");
      protectedLegacy.set(id, fingerprint);
    }
    const preview = await t.action(makeFunctionReference<"action", Record<string, never>, {
      cards: Array<{ humanId: string; canonicalHumanId: string | null; phones: string[]; emails: string[] }>;
      cardsFingerprint: string;
    }>("identity/airtableSync:reconcileLegacyAirtableHumans"), {});
    const batchPrewriteFingerprints: string[] = [];
    const reviewedBatchPrewriteFingerprints: string[] = [];
    const batchPostwriteFingerprints: string[] = [];
    const reviewedBatchPostwriteFingerprints: string[] = [];
    for (let i = 0; i < preview.cards.length; i += 50) {
      const cards = preview.cards.slice(i, i + 50);
      const prewrite = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
      const generatedFingerprint = generatedScope ? (await semanticStateProof(prewrite, generatedScope, cards)).fingerprint : (await stateProof(prewrite)).fingerprint;
      const reviewedPrewrite = originalize(prewrite);
      const reviewedFingerprint = semanticScope ? (await semanticStateProof(reviewedPrewrite, semanticScope, cards)).fingerprint : (await stateProof(reviewedPrewrite)).fingerprint;
      batchPrewriteFingerprints.push(generatedFingerprint);
      reviewedBatchPrewriteFingerprints.push(reviewedFingerprint);
      const batchStart = performance.now();
      let predictedPost: State | undefined;
      const rollbackBatch = new Error("OFFLINE_BATCH_PREDICTION_ROLLBACK");
      try {
        await t.run(async ctx => {
          await (reconcileBatch as unknown as { _handler: (context: typeof ctx, args: { cards: typeof cards }) => Promise<unknown> })
            ._handler(ctx, { cards });
          predictedPost = { people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() };
          throw rollbackBatch;
        });
      } catch (error) { if (error !== rollbackBatch) throw error; }
      if (!predictedPost) throw new Error("Offline batch prediction missing");
      const generatedPost = generatedScope ? (await semanticStateProof(predictedPost, generatedScope, cards)).fingerprint
        : (await stateProof(predictedPost)).fingerprint;
      const reviewedPost = originalize(predictedPost);
      const reviewedPostFingerprint = semanticScope ? (await semanticStateProof(reviewedPost, semanticScope, cards)).fingerprint
        : (await stateProof(reviewedPost)).fingerprint;
      await t.mutation(makeFunctionReference<"mutation", { cards: typeof cards; expectedStateFingerprint: string;
        expectedPostwriteFingerprint: string; semanticGuard?: SemanticGuard }>("identity/canonicalReconciliation:reconcileBatch"),
      { cards, expectedStateFingerprint: generatedFingerprint, expectedPostwriteFingerprint: generatedPost,
        semanticGuard: generatedScope });
      const actualPost = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
      const actualFingerprint = generatedScope ? (await semanticStateProof(actualPost, generatedScope, cards)).fingerprint
        : (await stateProof(actualPost)).fingerprint;
      if (actualFingerprint !== generatedPost) throw new Error("Offline batch post-state differs from reviewed prediction");
      batchPostwriteFingerprints.push(generatedPost);
      reviewedBatchPostwriteFingerprints.push(reviewedPostFingerprint);
      batchMutationDurationsMs.push(Math.round(performance.now() - batchStart));
    }
    const replaced = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
    const proof = await stateProof(replaced);
    let predicted: State | undefined;
    const rollback = new Error("LOCAL_PREVIEW_ROLLBACK");
    try { await t.run(async ctx => {
      const affected = new Set<Id<"people">>();
      for (const entry of proof.legacy.filter(({ id }) => !protectedGenerated.has(id))) {
        const row = await ctx.db.get(entry.id);
        if (row?.person_id) affected.add(row.person_id);
        await ctx.db.delete(entry.id);
      }
      for (const id of affected) await recomputePersonAggregates(ctx, id);
      predicted = { people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() };
      throw rollback;
    }); } catch (e) { if (e !== rollback) throw e; }
    if (!predicted) throw new Error("Missing local prediction");
    const plan: CleanupPlan = { initialFingerprint: (await stateProof(before)).fingerprint,
      cardsFingerprint: preview.cardsFingerprint, legacy: proof.legacy,
      protectedLegacy: proof.legacy.filter(({ id }) => protectedGenerated.has(id)),
      beforeRemovalFingerprint: proof.fingerprint, replacementFingerprint: proof.replacementFingerprint,
      afterRemovalFingerprint: (await stateProof(predicted)).fingerprint, batchPrewriteFingerprints, batchPostwriteFingerprints };
    if (generatedScope) plan.semanticGuard = await stampGuard(generatedScope, before, replaced, predicted);
    const originalProof = await stateProof(originalize(replaced));
    reviewedPlan = { ...plan, initialFingerprint: (await stateProof(originalize(before))).fingerprint,
      legacy: originalProof.legacy, beforeRemovalFingerprint: originalProof.fingerprint,
      protectedLegacy: originalProof.legacy.filter(({ id }) => originalProtected.has(id)),
      replacementFingerprint: originalProof.replacementFingerprint,
      afterRemovalFingerprint: (await stateProof(originalize(predicted))).fingerprint,
      batchPrewriteFingerprints: reviewedBatchPrewriteFingerprints, batchPostwriteFingerprints: reviewedBatchPostwriteFingerprints };
    if (semanticScope) reviewedPlan.semanticGuard = await stampGuard(semanticScope,
      originalize(before), originalize(replaced), originalize(predicted));
    result = await t.mutation(makeFunctionReference<"mutation", { plan: CleanupPlan }>("identity/canonicalReconciliation:removeLegacy"), { plan });
  } finally {
    protectedLegacy.clear();
    for (const [id, fingerprint] of originalProtected) protectedLegacy.set(id, fingerprint);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  }
  const after = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
  const independentBefore = before.identities.filter(r => r.source !== "airtable_human");
  const afterIdentitiesById = new Map(after.identities.map(row => [row._id, row]));
  const independentChanged = independentBefore.filter(r => JSON.stringify(r) !== JSON.stringify(afterIdentitiesById.get(r._id)));
  if (independentChanged.length) throw new Error("Independent source changed");
  const originalPerson = new Map([...ids].map(([a, b]) => [b, a]));
  const groupBy = <T,>(rows: T[], key: (row: T) => string | undefined) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const id = key(row);
      if (id === undefined) continue;
      const group = groups.get(id) ?? [];
      group.push(row);
      groups.set(id, group);
    }
    return groups;
  };
  const inputPeople = new Map(input.people.map(person => [person._id, person]));
  const beforeByPerson = groupBy(before.identities, row => row.person_id);
  const afterByPerson = groupBy(after.identities, row => row.person_id);
  const beforeByHuman = groupBy(input.identities.filter(row => row.source === "airtable_human"),
    row => row.source_contact_id || (row.person_id ? inputPeople.get(row.person_id)?.airtable_human_id : undefined));
  const afterByHuman = groupBy(after.identities.filter(row => row.source === "airtable_human"), row => row.source_contact_id);
  const contactsByHuman = groupBy(input.canonical.contacts, row => row.humanId);
  const recordsById = new Map<string, RecordRow>();
  for (const row of input.records) if (!recordsById.has(row.id)) recordsById.set(row.id, row);
  const resolutionsByHuman = groupBy(input.canonical.resolutions, row => row.humanId);
  const afterPeopleById = new Map(after.people.map(person => [person._id, person]));
  const personDetails = before.people.map(p => {
    const a = afterPeopleById.get(p._id)!;
    const old = beforeByPerson.get(p._id) ?? [], next = afterByPerson.get(p._id) ?? [];
    const oldKeys = sorted(old.map(key)), newKeys = sorted(next.map(key));
    return { personId: originalPerson.get(p._id), humanIdBefore: p.airtable_human_id, humanIdAfter: a.airtable_human_id,
      independentSources: old.filter(r => r.source !== "airtable_human").length,
      before: old.map(r => ({ key: key(r), source: r.source, humanId: r.source_contact_id })),
      after: next.map(r => ({ key: key(r), source: r.source, humanId: r.source_contact_id })),
      removedKeys: oldKeys.filter(k => !newKeys.includes(k)), addedKeys: newKeys.filter(k => !oldKeys.includes(k)),
      disposition: newKeys.length ? "retains-identifiers" : "no-identifiers",
      canonicalProof: p.airtable_human_id ? resolutionsByHuman.get(p.airtable_human_id) ?? [] : [],
      canonicalContacts: p.airtable_human_id ? contactsByHuman.get(p.airtable_human_id) ?? [] : [],
      aggregatesBefore: { phones: p.normalized_phones, emails: p.normalized_emails, primaryHandle: p.primary_handle },
      aggregatesAfter: { phones: a.normalized_phones, emails: a.normalized_emails, primaryHandle: a.primary_handle } };
  });
  const humanIds = sorted([...input.records.map(r => r.id), ...input.canonical.resolutions.map(r => r.humanId)]);
  const humans = humanIds.map(humanId => ({ humanId,
    nativeDisplay: recordsById.get(humanId)?.fields,
    resolution: resolutionsByHuman.get(humanId)?.[0],
    canonicalContacts: contactsByHuman.get(humanId) ?? [],
    before: beforeByHuman.get(humanId) ?? [],
    after: (afterByHuman.get(humanId) ?? []).map(r => ({ ...r, person_id: r.person_id ? originalPerson.get(r.person_id) : undefined })) }));
  const special = personDetails.filter(p => !p.independentSources && p.before.some(r => r.source === "airtable_human"));
  const globalAfter = new Set(after.identities.map(key));
  const beforeIdentityIds = new Set(before.identities.map(row => row._id));
  const sortedBatchDurations = [...batchMutationDurationsMs].sort((a,b) => a - b);
  const summary = { liveWrites: 0, peopleBefore: before.people.length, peopleAfter: after.people.length,
    batchCount: batchMutationDurationsMs.length, maxBatchMutationMs: sortedBatchDurations.at(-1) ?? 0,
    p95BatchMutationMs: sortedBatchDurations[Math.floor(sortedBatchDurations.length * 0.95)] ?? 0,
    identitiesBefore: before.identities.length, identitiesAfter: after.identities.length,
    legacyRemoved: (result as { removed: number }).removed,
    protectedLegacyRetained: protectedGenerated.size,
    canonicalRowsAfter: after.identities.filter(r => r.source === "airtable_human").length,
    newlyInsertedRows: after.identities.filter(r => !beforeIdentityIds.has(r._id)).length,
    genuinelyRemovedDistinctIdentifiers: sorted(before.identities.map(key)).filter(k => !globalAfter.has(k)).length,
    removedPersonIdentifierPairs: personDetails.reduce((n,p) => n + p.removedKeys.length, 0),
    addedPersonIdentifierPairs: personDetails.reduce((n,p) => n + p.addedKeys.length, 0),
    linkChanges: personDetails.filter(p => p.humanIdBefore !== p.humanIdAfter).length,
    independentSourceRemovals: 0, independentSourceChanges: 0,
    withoutIndependentSources: special.length, withoutIndependentSourcesRetainingIdentifiers: special.filter(p => p.disposition === "retains-identifiers").length,
    withoutIndependentSourcesLosingAllIdentifiers: special.filter(p => p.disposition === "no-identifiers").length };
  return { summary, result, reviewedPlan, humans, people: personDetails, withoutIndependentSources: special };
}

test.skipIf(Boolean(process.env.CANONICAL_PREVIEW_INPUT))("offline operator preserves independent ownership and proves replacement delta", async () => {
  const now = "2026-10-18"; const person = "fixture" as Id<"people">; const human = "recAAAAAAAAAAAAAA";
  const p = { _id: person, _creationTime: 1, normalized_phones: [], normalized_emails: ["old@example.test"], identity_count: 1, message_count: 0, is_self: false, auto_clustered: true, created_at: now, updated_at: now, airtable_human_id: human };
  const row = { _id: "legacy" as Id<"identities">, _creationTime: 1, person_id: person, kind: "email", value: "old@example.test", normalized: "old@example.test", message_count: 0, chat_count: 0, is_self: false, source: "airtable_human", created_at: now, updated_at: now };
  const r = await replay({ complete: true, people: [p], identities: [row, { ...row, _id: "independent" as Id<"identities">, source: "manual" }], records: [{ id: human, fields: { Name: "Fixture" } }], canonical: { resolutions: [{ humanId: human, canonicalHumanId: human }], contacts: [{ humanId: human, channel: "email", value: "new@example.test", primary: true }] } });
  expect(r.summary).toMatchObject({ legacyRemoved: 1, canonicalRowsAfter: 1, independentSourceChanges: 0, genuinelyRemovedDistinctIdentifiers: 0, addedPersonIdentifierPairs: 1 });
  const empty = await replay({ complete: true, people: [p], identities: [row], records: [{ id: human, fields: { Name: "Fixture" } }], canonical: { resolutions: [{ humanId: human, canonicalHumanId: human }], contacts: [] } });
  expect(empty.summary).toMatchObject({ withoutIndependentSources: 1, withoutIndependentSourcesLosingAllIdentifiers: 1, genuinelyRemovedDistinctIdentifiers: 1 });
  expect(empty.withoutIndependentSources[0].canonicalProof).toEqual([{ humanId: human, canonicalHumanId: human }]);
});

test("offline operator stamps an optional bounded semantic guard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "canonical-replay-scope-"));
  const path = join(dir, "scope.json");
  writeFileSync(path, JSON.stringify({ allowAppleUpdatedAt: true, legacyOwnerRows: [], derivedPeople: [],
    initialFingerprint: "", beforeRemovalFingerprint: "", afterRemovalFingerprint: "", legacyFingerprint: "" }), { mode: 0o600 });
  vi.stubEnv("CANONICAL_PREVIEW_SEMANTIC_SCOPE", path);
  try {
    const person = "fixture" as Id<"people">; const human = "recAAAAAAAAAAAAAA";
    const before = { _id: person, _creationTime: 1, normalized_phones: [], normalized_emails: ["old@example.test"],
      identity_count: 1, message_count: 0, is_self: false, auto_clustered: true, created_at: "fixture", updated_at: "fixture", airtable_human_id: human };
    const legacy = { _id: "legacy" as Id<"identities">, _creationTime: 1, person_id: person, kind: "email", value: "old@example.test",
      normalized: "old@example.test", message_count: 0, chat_count: 0, is_self: false, source: "airtable_human", created_at: "fixture", updated_at: "fixture" };
    const result = await replay({ complete: true, people: [before], identities: [legacy], records: [{ id: human, fields: { Name: "Fixture" } }],
      canonical: { resolutions: [{ humanId: human, canonicalHumanId: human }], contacts: [{ humanId: human, channel: "email", value: "new@example.test", primary: true }] } });
    expect(result.reviewedPlan?.semanticGuard).toMatchObject({ allowAppleUpdatedAt: true, legacyOwnerRows: [], derivedPeople: [] });
    expect(result.summary.legacyRemoved).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test.skipIf(!process.env.CANONICAL_PREVIEW_INPUT)("restricted offline snapshot replay", async () => {
  try {
    const input = JSON.parse(readFileSync(process.env.CANONICAL_PREVIEW_INPUT!, "utf8")) as Input;
    const result = await replay(input);
    const prefix = process.env.CANONICAL_PREVIEW_OUTPUT!;
    if (!prefix) throw new Error("Output prefix required");
    save(`${prefix}.details.json`, result);
    save(`${prefix}.summary.json`, result.summary);
  } catch { throw new Error("Offline replay failed; no contact values emitted. Inspect restricted inputs locally."); }
}, 120000);
