import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { semanticStateProof, stateProof, type CleanupPlan, type State } from "./cleanupPlan";
import { ingestOneCard } from "./ingestContacts";
import { recomputePersonAggregates } from "./internal";
import { assertProtectedPlan, protectedLegacy, unreviewedLegacyCount } from "./protectedLegacy";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const remove = makeFunctionReference<"mutation", { plan: CleanupPlan }>("identity/canonicalReconciliation:removeLegacy");
const approvedProtected = new Map(protectedLegacy);
beforeEach(() => protectedLegacy.clear());
afterEach(() => {
  protectedLegacy.clear();
  for (const [id, fingerprint] of approvedProtected) protectedLegacy.set(id, fingerprint);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
async function fixture(options: { apple?: boolean } = {}) {
  const t = convexTest(schema, modules);
  await t.run(ctx => ingestOneCard(ctx, "airtable_human", { airtable_record_id: "recAAAAAAAAAAAAAA", phones: [], emails: ["old@example.test"] }, false));
  await t.run(ctx => ingestOneCard(ctx, "airtable_human", { airtable_record_id: "recAAAAAAAAAAAAAA", source_contact_id: "recAAAAAAAAAAAAAA", phones: [], emails: ["new@example.test"] }, true));
  if (options.apple) await t.run(ctx => ingestOneCard(ctx, "apple_contact", { phones: [], emails: ["apple@example.test"] }, false));
  const state = () => t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
  await t.run(async ctx => { const person = (await ctx.db.query("people").collect())[0]; await ctx.db.patch(person._id, { primary_handle: "old@example.test" }); });
  const before = await state(); const proof = await stateProof(before);
  let afterFingerprint = ""; let predicted: State | undefined; const rollback = new Error("rollback");
  try { await t.run(async ctx => {
    const affected = new Set<Id<"people">>();
    for (const entry of proof.legacy) { const row = await ctx.db.get(entry.id); if (row?.person_id) affected.add(row.person_id); await ctx.db.delete(entry.id); }
    for (const id of affected) await recomputePersonAggregates(ctx,id);
    predicted = { people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() };
    afterFingerprint = (await stateProof(predicted)).fingerprint;
    throw rollback;
  }); } catch (e) { if (e !== rollback) throw e; }
  const plan: CleanupPlan = { initialFingerprint: proof.fingerprint, cardsFingerprint: "fixture", beforeRemovalFingerprint: proof.fingerprint,
    afterRemovalFingerprint: afterFingerprint, replacementFingerprint: proof.replacementFingerprint, legacy: proof.legacy };
  if (!predicted) throw new Error("Missing predicted state");
  return { t, state, plan, before, predicted };
}
test("semantic cleanup guard permits only Apple update time drift", async () => {
  const { t, state, plan, before, predicted } = await fixture({ apple: true });
  const scope = { allowAppleUpdatedAt: true, legacyOwnerRows: [], derivedPeople: [],
    initialFingerprint: "", beforeRemovalFingerprint: "", afterRemovalFingerprint: "", legacyFingerprint: "" };
  const initial = await semanticStateProof(before, scope);
  const after = await semanticStateProof(predicted, scope);
  plan.semanticGuard = { ...scope, initialFingerprint: initial.fingerprint,
    beforeRemovalFingerprint: initial.fingerprint, afterRemovalFingerprint: after.fingerprint,
    legacyFingerprint: initial.legacyFingerprint };
  const apple = before.identities.find(row => row.source === "apple_contact")!;
  await t.run(ctx => ctx.db.patch(apple._id, { updated_at: "later" }));
  expect((await stateProof(await state())).fingerprint).not.toBe(plan.initialFingerprint);
  expect((await semanticStateProof(await state(), plan.semanticGuard!)).fingerprint).toBe(plan.semanticGuard.initialFingerprint);
  vi.stubEnv("AIRTABLE_API_KEY", "");
  await expect(t.action(makeFunctionReference<"action", { apply: boolean; plan: CleanupPlan }>("identity/airtableSync:reconcileLegacyAirtableHumans"),
    { apply: true, plan })).rejects.toThrow("AIRTABLE_API_KEY not configured");
  vi.unstubAllEnvs();
  expect((await t.mutation(remove, { plan })).removed).toBe(1);
});
test("semantic cleanup guard rejects a changed independent contact atomically", async () => {
  const { t, state, plan, before, predicted } = await fixture({ apple: true });
  const scope = { allowAppleUpdatedAt: true, legacyOwnerRows: [], derivedPeople: [],
    initialFingerprint: "", beforeRemovalFingerprint: "", afterRemovalFingerprint: "", legacyFingerprint: "" };
  const initial = await semanticStateProof(before, scope);
  const after = await semanticStateProof(predicted, scope);
  plan.semanticGuard = { ...scope, initialFingerprint: initial.fingerprint,
    beforeRemovalFingerprint: initial.fingerprint, afterRemovalFingerprint: after.fingerprint,
    legacyFingerprint: initial.legacyFingerprint };
  const apple = before.identities.find(row => row.source === "apple_contact")!;
  await t.run(ctx => ctx.db.patch(apple._id, { normalized: "changed@example.test" }));
  const drifted = await state();
  await expect(t.action(makeFunctionReference<"action", { apply: boolean; plan: CleanupPlan }>("identity/airtableSync:reconcileLegacyAirtableHumans"),
    { apply: true, plan })).rejects.toThrow("initial state drift");
  await expect(t.mutation(remove, { plan })).rejects.toThrow("Cleanup plan drift");
  expect(await state()).toEqual(drifted);
});
test("semantic guard binds a legacy owner move and only its derived people", async () => {
  const { before, plan } = await fixture();
  const original = before.people[0];
  const secondId = "second-person" as Id<"people">;
  const first: State = globalThis.structuredClone(before);
  first.people[0].primary_handle = undefined;
  first.people.push({ ...original, _id: secondId, primary_handle: undefined, airtable_human_id: undefined,
    normalized_emails: [], normalized_phones: [], identity_count: 0 });
  const moved: State = globalThis.structuredClone(first);
  const legacy = moved.identities.find(row => row._id === plan.legacy[0].id)!;
  legacy.person_id = secondId;
  legacy.updated_at = "later";
  moved.people[0].normalized_emails = ["new@example.test"];
  moved.people[0].identity_count = 1;
  moved.people[1].normalized_emails = ["old@example.test"];
  moved.people[1].identity_count = 1;
  const scope = { allowAppleUpdatedAt: false,
    legacyOwnerRows: [{ id: legacy._id, allowedPersonIds: [original._id, secondId] }],
    derivedPeople: [original._id, secondId], initialFingerprint: "", beforeRemovalFingerprint: "", afterRemovalFingerprint: "", legacyFingerprint: "" };
  const baseline = await semanticStateProof(first, scope);
  const changed = await semanticStateProof(moved, scope);
  expect(changed).toEqual(baseline);
  expect((await semanticStateProof(moved, { ...scope, derivedPeople: [] })).fingerprint)
    .not.toBe((await semanticStateProof(first, { ...scope, derivedPeople: [] })).fingerprint);
  await expect(semanticStateProof(moved, { ...scope, legacyOwnerRows: [{ id: legacy._id,
    allowedPersonIds: [original._id] }] })).rejects.toThrow("outside reviewed set");
  moved.people[1].identity_count = 2;
  await expect(semanticStateProof(moved, scope)).rejects.toThrow("Derived person aggregates are not current");
});
test("exact cleanup emits receipts and deletes only reviewed legacy rows", async () => {
  const { t, state, plan } = await fixture();
  const receipt = await t.mutation(remove,{plan});
  expect(receipt).toMatchObject({ removed: 1, beforeFingerprint: plan.beforeRemovalFingerprint, afterFingerprint: plan.afterRemovalFingerprint, replacementFingerprint: plan.replacementFingerprint });
  expect((await state()).identities.map(r=>r.value)).toEqual(["new@example.test"]);
  expect((await state()).people[0].primary_handle).toBeUndefined();
});

test("a reviewed protected legacy row survives cleanup and is accepted by the hourly guard", async () => {
  const { t, state, plan } = await fixture();
  const entry = plan.legacy[0];
  const saved = new Map(protectedLegacy);
  protectedLegacy.clear();
  protectedLegacy.set(entry.id, entry.fingerprint);
  try {
    plan.protectedLegacy = [entry];
    plan.afterRemovalFingerprint = plan.beforeRemovalFingerprint;
    assertProtectedPlan(plan);
    const receipt = await t.mutation(remove, { plan });
    expect(receipt.removed).toBe(0);
    expect((await state()).identities.some((r) => r._id === entry.id)).toBe(true);
    const source = makeFunctionReference<"query", Record<string, never>, { legacyCount: number }>("identity/canonicalReconciliation:sourceState");
    expect((await t.query(source, {})).legacyCount).toBe(0);
    const beforeProtected = (await state()).identities.find(row => row._id === entry.id);
    vi.stubEnv("AIRTABLE_API_KEY", "synthetic");
    vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "synthetic");
    vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("api.airtable.com")) return Response.json({ records: [{ id: "recAAAAAAAAAAAAAA", fields: { Name: "Fixture" } }] });
      const { humanIds } = JSON.parse(init!.body as string) as { humanIds: string[] };
      return Response.json({ resolutions: humanIds.map(humanId => ({ humanId, canonicalHumanId: humanId })),
        contacts: humanIds.map(humanId => ({ humanId, channel: "email", value: "new@example.test", primary: true })) });
    }));
    const scheduled = makeFunctionReference<"action", Record<string, never>, { recordsSeen: number; legacyRemoved: number }>("identity/airtableSync:syncAirtableHumans");
    expect(await t.action(scheduled, {})).toMatchObject({ recordsSeen: 1, legacyRemoved: 0 });
    expect((await state()).identities.find(row => row._id === entry.id)).toEqual(beforeProtected);
    expect((await t.query(source, {})).legacyCount).toBe(0);
    const batch = makeFunctionReference<"mutation", { cards: { humanId: string; canonicalHumanId: string | null; phones: string[]; emails: string[] }[] }>("identity/canonicalReconciliation:reconcileBatch");
    const cards = [{ humanId: "recAAAAAAAAAAAAAA", canonicalHumanId: "recAAAAAAAAAAAAAA", phones: [], emails: [] }];
    await t.run((ctx) => ctx.db.patch(entry.id, { source_contact_id: "recAAAAAAAAAAAAAA" }));
    expect((await t.query(source, {})).legacyCount).toBe(1);
    let unchanged = await state();
    await expect(t.mutation(batch, { cards })).rejects.toThrow("Protected legacy identity drift");
    expect(await state()).toEqual(unchanged);
    await t.run((ctx) => ctx.db.patch(entry.id, { source_contact_id: undefined, source: "manual" }));
    expect((await t.query(source, {})).legacyCount).toBe(1);
    unchanged = await state();
    await expect(t.mutation(batch, { cards })).rejects.toThrow("Protected legacy identity drift");
    expect(await state()).toEqual(unchanged);
    await t.run((ctx) => ctx.db.patch(entry.id, { source: "airtable_human" }));
    await t.run((ctx) => ctx.db.patch(entry.id, { display_name: "Changed" }));
    expect((await t.query(source, {})).legacyCount).toBe(1);
    await t.run((ctx) => ingestOneCard(ctx, "airtable_human", { emails: ["unreviewed@example.test"], phones: [] }, false));
    expect((await t.query(source, {})).legacyCount).toBe(2);
    await t.run((ctx) => ctx.db.delete(entry.id));
    expect((await t.query(source, {})).legacyCount).toBe(2);
    const unchangedAfterLoss = await state();
    await expect(t.mutation(batch, { cards })).rejects.toThrow("Protected legacy identity drift");
    expect(await state()).toEqual(unchangedAfterLoss);
  } finally {
    protectedLegacy.clear();
    for (const [id, fingerprint] of saved) protectedLegacy.set(id, fingerprint);
  }
});

test("scheduled sync accepts seven exact protected legacy rows", async () => {
  const t = convexTest(schema, modules);
  for (let i = 0; i < 7; i++) await t.run(ctx => ingestOneCard(ctx, "airtable_human", {
    emails: [`protected-${i}@example.test`], phones: [],
  }, false));
  const before = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
  for (const entry of (await stateProof(before)).legacy) protectedLegacy.set(entry.id, entry.fingerprint);
  const source = makeFunctionReference<"query", Record<string, never>, { legacyCount: number }>("identity/canonicalReconciliation:sourceState");
  expect((await t.query(source, {})).legacyCount).toBe(0);
  vi.stubEnv("AIRTABLE_API_KEY", "synthetic");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "synthetic");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (String(input).includes("api.airtable.com")) return Response.json({ records: [] });
    const { humanIds } = JSON.parse(init!.body as string) as { humanIds: string[] };
    return Response.json({ resolutions: humanIds.map(humanId => ({ humanId, canonicalHumanId: null })), contacts: [] });
  }));
  const scheduled = makeFunctionReference<"action", Record<string, never>, { recordsSeen: number; legacyRemoved: number }>("identity/airtableSync:syncAirtableHumans");
  expect(await t.action(scheduled, {})).toMatchObject({ recordsSeen: 0, legacyRemoved: 0 });
  expect(await t.run(ctx => ctx.db.query("identities").collect())).toEqual(before.identities);
  expect((await t.query(source, {})).legacyCount).toBe(0);
});

test("protected plan refuses omitted, changed, duplicate, or extra exclusions", async () => {
  const { plan } = await fixture();
  const entry = plan.legacy[0];
  protectedLegacy.set(entry.id, entry.fingerprint);
  try {
    expect(() => assertProtectedPlan(plan)).toThrow("Exact protected legacy manifest required");
    plan.protectedLegacy = [entry];
    expect(() => assertProtectedPlan(plan)).not.toThrow();
    expect(unreviewedLegacyCount([entry])).toBe(0);
    expect(unreviewedLegacyCount([{ ...entry, fingerprint: "changed" }])).toBe(1);
    plan.protectedLegacy = [entry, entry];
    expect(() => assertProtectedPlan(plan)).toThrow();
    plan.protectedLegacy = [{ ...entry, fingerprint: "changed" }];
    expect(() => assertProtectedPlan(plan)).toThrow("Protected legacy fingerprint drift");
    plan.protectedLegacy = [{ id: "unapproved" as Id<"identities">, fingerprint: "changed" }];
    expect(() => assertProtectedPlan(plan)).toThrow();
  } finally {
    protectedLegacy.delete(entry.id);
  }
});
test("semantic plan requires every configured protected ID in the legacy scope", async () => {
  const { plan } = await fixture();
  protectedLegacy.set("missing" as Id<"identities">, "reviewed");
  plan.semanticGuard = { allowAppleUpdatedAt: false, legacyOwnerRows: [], derivedPeople: [],
    initialFingerprint: "", beforeRemovalFingerprint: "", afterRemovalFingerprint: "", legacyFingerprint: "" };
  expect(() => assertProtectedPlan(plan)).toThrow("All protected legacy IDs required");
});
for (const change of ["new-legacy", "changed-legacy", "replacement", "after-proof"] as const) {
  test(`cleanup fails closed on ${change} without deleting rows`, async () => {
    const { t, state, plan } = await fixture();
    if (change === "new-legacy") await t.run(ctx => ingestOneCard(ctx,"airtable_human",{phones:[],emails:["late@example.test"]},false));
    if (change === "changed-legacy") await t.run(ctx => ctx.db.patch(plan.legacy[0].id,{ display_name:"Changed" }));
    if (change === "replacement") plan.replacementFingerprint = "wrong";
    if (change === "after-proof") plan.afterRemovalFingerprint = "wrong";
    const before = await state();
    await expect(t.mutation(remove,{plan})).rejects.toThrow();
    expect(await state()).toEqual(before);
  });
}

test("apply rejects initial drift before any remote read or replacement", async () => {
  const { t, plan, state } = await fixture();
  const before = await state();
  plan.initialFingerprint = "stale";
  await expect(t.action(makeFunctionReference<"action", {apply:boolean;plan:CleanupPlan}>("identity/airtableSync:reconcileLegacyAirtableHumans"), {apply:true,plan})).rejects.toThrow("initial state drift");
  expect(await state()).toEqual(before);
});
