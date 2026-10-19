import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { stateProof, type CleanupPlan } from "./cleanupPlan";
import { ingestOneCard } from "./ingestContacts";
import { recomputePersonAggregates } from "./internal";
import { assertProtectedPlan, protectedLegacy, unreviewedLegacyCount } from "./protectedLegacy";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const remove = makeFunctionReference<"mutation", { plan: CleanupPlan }>("identity/canonicalReconciliation:removeLegacy");
async function fixture() {
  const t = convexTest(schema, modules);
  await t.run(ctx => ingestOneCard(ctx, "airtable_human", { airtable_record_id: "recAAAAAAAAAAAAAA", phones: [], emails: ["old@example.test"] }, false));
  await t.run(ctx => ingestOneCard(ctx, "airtable_human", { airtable_record_id: "recAAAAAAAAAAAAAA", source_contact_id: "recAAAAAAAAAAAAAA", phones: [], emails: ["new@example.test"] }, true));
  const state = () => t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
  await t.run(async ctx => { const person = (await ctx.db.query("people").collect())[0]; await ctx.db.patch(person._id, { primary_handle: "old@example.test" }); });
  const before = await state(); const proof = await stateProof(before);
  let afterFingerprint = ""; const rollback = new Error("rollback");
  try { await t.run(async ctx => {
    const affected = new Set<Id<"people">>();
    for (const entry of proof.legacy) { const row = await ctx.db.get(entry.id); if (row?.person_id) affected.add(row.person_id); await ctx.db.delete(entry.id); }
    for (const id of affected) await recomputePersonAggregates(ctx,id);
    afterFingerprint = (await stateProof({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() })).fingerprint;
    throw rollback;
  }); } catch (e) { if (e !== rollback) throw e; }
  const plan: CleanupPlan = { initialFingerprint: proof.fingerprint, cardsFingerprint: "fixture", beforeRemovalFingerprint: proof.fingerprint,
    afterRemovalFingerprint: afterFingerprint, replacementFingerprint: proof.replacementFingerprint, legacy: proof.legacy };
  return { t, state, plan, before };
}
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
    await t.run((ctx) => ctx.db.patch(entry.id, { display_name: "Changed" }));
    expect((await t.query(source, {})).legacyCount).toBe(1);
    await t.run((ctx) => ingestOneCard(ctx, "airtable_human", { emails: ["unreviewed@example.test"], phones: [] }, false));
    expect((await t.query(source, {})).legacyCount).toBe(2);
  } finally {
    protectedLegacy.delete(entry.id);
  }
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
