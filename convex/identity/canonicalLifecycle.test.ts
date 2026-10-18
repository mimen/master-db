import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { ingestOneCard } from "./ingestContacts";
import { addPersonFromAirtableRef, listPeopleRef, nameDirectoryRef, searchAirtableHumansRef, setPrimaryHandleRef, TEST_KEY, whoIsRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
const a = "recAAAAAAAAAAAAAA", c = "recCCCCCCCCCCCCCC";
const sync = makeFunctionReference<"action", Record<string, never>>("identity/airtableSync:syncAirtableHumans");
const cleanup = makeFunctionReference<"action", { apply?: boolean }>("identity/airtableSync:reconcileLegacyAirtableHumans");
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function fixture() {
  vi.stubEnv("IMSG_SERVER_SECRET", TEST_KEY);
  vi.stubEnv("AIRTABLE_API_KEY", "synthetic");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "synthetic");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
  const state = { records: [{ id: a, fields: { Name: "Fixture", "Primary Email": "revoked@example.test", "Primary Phone": "+16195550100" } }],
    target: a as string | null, emails: ["secondary@example.test", "imported@example.test"], phones: [] as string[] };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (String(input).includes("api.airtable.com")) return Response.json({ records: state.records });
    const { humanIds } = JSON.parse(init!.body as string) as { humanIds: string[] };
    return Response.json({ resolutions: humanIds.map((humanId) => ({ humanId, canonicalHumanId: state.target })),
      contacts: humanIds.flatMap((humanId) => state.target ? [
        ...state.emails.map((value) => ({ humanId, channel: "email", value, primary: false })),
        ...state.phones.map((value) => ({ humanId, channel: "sms", value, primary: false })),
      ] : []) });
  }));
  return { state, t: convexTest(schema, modules) };
}

test("excluded display scalars cannot become recipients or scalar-only join keys; empty/tombstoned rows disappear", async () => {
  const { t, state } = fixture();
  const rows = await t.action(searchAirtableHumansRef, { key: TEST_KEY, query: "Fixture" }) as Array<{ record_id: string; display_name: string; phone?: string; email?: string }>;
  expect(rows).toHaveLength(1);
  expect(rows[0].phone).toBeUndefined();
  expect(rows[0].email).toBe("secondary@example.test");
  // Both composer callbacks choose phone || email. The legacy mutation receives the same scalars.
  expect(rows[0].phone || rows[0].email).toBe("secondary@example.test");
  await t.mutation(addPersonFromAirtableRef, { key: TEST_KEY, record_id: rows[0].record_id, phone: rows[0].phone, email: rows[0].email });
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "revoked@example.test" })).toMatchObject({ found: false });
  state.emails = [];
  expect(await t.action(searchAirtableHumansRef, { key: TEST_KEY, query: "Fixture" })).toEqual([]);
  state.target = null;
  expect(await t.action(searchAirtableHumansRef, { key: TEST_KEY, query: "Fixture" })).toEqual([]);
});

test("formatted primary display is preserved only when canonical normalization agrees", async () => {
  const { t, state } = fixture();
  state.records[0].fields["Primary Phone"] = "(619) 555-0100";
  state.phones = ["+16195550100"];
  const rows = await t.action(searchAirtableHumansRef, { key: TEST_KEY, query: "Fixture" }) as { phone: string }[];
  expect(rows[0].phone).toBe("(619) 555-0100");
});

test("complete sync withdraws canonical-only handles and preserves independent identities", async () => {
  const { t, state } = fixture();
  await t.run((ctx) => ingestOneCard(ctx, "apple_contact", { emails: ["secondary@example.test"], phones: [] }, false));
  await t.action(sync, {});
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "imported@example.test" })).toMatchObject({ found: true });
  state.emails = ["secondary@example.test"];
  await t.action(sync, {});
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "imported@example.test" })).toMatchObject({ found: false });
  expect((await t.run((ctx) => ctx.db.query("people").collect()))[0].normalized_emails).not.toContain("imported@example.test");
  state.emails = [];
  await t.action(sync, {});
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "secondary@example.test" })).toMatchObject({ found: true });
  expect(await t.run((ctx) => ctx.db.query("identities").collect())).toHaveLength(1);
});

test("redirect evidence repairs old links and provenance; removed Humans withdraw contacts", async () => {
  const { t, state } = fixture();
  await t.run((ctx) => ingestOneCard(ctx, "apple_contact", { emails: ["secondary@example.test"], phones: [] }, false));
  await t.action(sync, {});
  state.target = c;
  state.records[0].id = c;
  await t.action(sync, {});
  const people = await t.run((ctx) => ctx.db.query("people").collect());
  expect(people).toHaveLength(1);
  expect(people[0].airtable_human_id).toBe(c);
  const rows = await t.action(searchAirtableHumansRef, { key: TEST_KEY, query: "Fixture" }) as { record_id: string }[];
  expect(rows.filter((r) => !new Set(people.map((p) => p.airtable_human_id)).has(r.record_id))).toEqual([]);
  const sourceRows = await t.run((ctx) => ctx.db.query("identities").collect());
  expect(sourceRows.filter((r) => r.source === "airtable_human").every((r) => r.source_contact_id === c)).toBe(true);
  state.records = [];
  await t.action(sync, {});
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "imported@example.test" })).toMatchObject({ found: false });
  expect((await t.run((ctx) => ctx.db.query("people").collect()))[0].airtable_human_id).toBeUndefined();
});

test("shared contacts alone cannot replace a different live Human link", async () => {
  const { t, state } = fixture();
  await t.run((ctx) => ingestOneCard(ctx, "apple_contact", { emails: ["secondary@example.test"], phones: [] }, false));
  await t.action(sync, {});
  state.records.push({ ...state.records[0], id: c });
  // No redirect for A: use per-request identity mapping for this fixture.
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (String(input).includes("api.airtable.com")) return Response.json({ records: state.records });
    const { humanIds } = JSON.parse(init!.body as string) as { humanIds: string[] };
    return Response.json({ resolutions: humanIds.map((humanId) => ({ humanId, canonicalHumanId: humanId })),
      contacts: humanIds.map((humanId) => ({ humanId, channel: "email", value: "secondary@example.test", primary: false })) });
  }));
  await t.action(sync, {});
  expect((await t.run((ctx) => ctx.db.query("people").collect()))[0].airtable_human_id).toBe(a);
});

test("legacy cleanup is preview-only by default and hourly sync refuses unreviewed legacy rows", async () => {
  const { t } = fixture();
  await t.run((ctx) => ingestOneCard(ctx, "airtable_human", { airtable_record_id: a, emails: ["secondary@example.test", "old@example.test"], phones: [] }, false));
  const before = await t.run((ctx) => ctx.db.query("identities").collect());
  await expect(t.action(sync, {})).rejects.toThrow("reviewed canonical cleanup");
  expect(await t.action(cleanup, {})).toMatchObject({ legacyWouldRemove: 2 });
  expect(await t.run((ctx) => ctx.db.query("identities").collect())).toEqual(before);
  await expect(t.action(cleanup, { apply: true })).rejects.toThrow("Exact reviewed cleanup plan required");
  expect(await t.run((ctx) => ctx.db.query("identities").collect())).toEqual(before);
});

test("complete preview reads beyond 100 pages without truncation", async () => {
  const { t } = fixture();
  let pages = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (String(input).includes("api.airtable.com")) {
      pages++;
      return Response.json({ records: [{ id: a, fields: { Name: "Fixture" } }], ...(pages < 101 ? { offset: String(pages) } : {}) });
    }
    const { humanIds } = JSON.parse(init!.body as string) as { humanIds: string[] };
    return Response.json({ contacts: [], resolutions: humanIds.map(humanId => ({ humanId, canonicalHumanId: humanId })) });
  }));
  await t.action(cleanup, {});
  expect(pages).toBe(101);
  expect(await t.run(ctx => ctx.db.query("identities").collect())).toEqual([]);
});

test("redirect reassignment recomputes both existing owners and later revocation leaves no stale aggregates", async () => {
  const { t, state } = fixture();
  await t.run(async ctx => {
    await ingestOneCard(ctx, "airtable_human", { airtable_record_id: a, source_contact_id: a, phones: [], emails: ["loser@example.test"] }, false);
    const survivor = await ingestOneCard(ctx, "airtable_human", { airtable_record_id: c, source_contact_id: c, phones: [], emails: ["survivor@example.test"] }, false);
    if (survivor.outcome !== "created") throw new Error("Fixture expected new person");
    await ctx.db.insert("identities", { person_id: survivor.personId, kind: "email", value: "independent@example.test", normalized: "independent@example.test", source: "apple_contact", message_count: 0, chat_count: 0, is_self: false, created_at: "fixture", updated_at: "fixture" });
  });
  const formerOwner = (await t.run(ctx => ctx.db.query("people").collect())).find(p => p.airtable_human_id === c)!;
  await t.mutation(setPrimaryHandleRef, { key: TEST_KEY, personId: formerOwner._id, handle: "survivor@example.test" });
  state.target = c; state.records[0].id = c; state.emails = ["survivor@example.test"];
  await t.action(sync, {});
  const assertAggregates = async () => {
    const data = await t.run(async ctx => ({ people: await ctx.db.query("people").collect(), identities: await ctx.db.query("identities").collect() }));
    for (const p of data.people) {
      const rows = data.identities.filter(r => r.person_id === p._id);
      expect(p.identity_count).toBe(rows.length);
      expect([...p.normalized_emails].sort()).toEqual([...new Set(rows.filter(r => r.normalized.includes("@")).map(r => r.normalized))].sort());
    }
  };
  await assertAggregates();
  expect((await t.run(ctx => ctx.db.get(formerOwner._id)))?.primary_handle).toBeUndefined();
  state.emails = []; await t.action(sync, {}); await assertAggregates();
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "independent@example.test" })).toMatchObject({ found: true });
  expect(await t.query(whoIsRef, { key: TEST_KEY, handle: "survivor@example.test" })).toMatchObject({ found: false });
  expect(JSON.stringify(await t.query(listPeopleRef, { key: TEST_KEY }))).not.toContain("survivor@example.test");
  expect((await t.query(nameDirectoryRef, { key: TEST_KEY })).some(r => r.normalized === "survivor@example.test")).toBe(false);
});

for (const selected of ["imported@example.test", "secondary@example.test"]) {
  test(`withdrawal validates selected primary against all remaining sources: ${selected}`, async () => {
    const { t, state } = fixture();
    await t.run(ctx => ingestOneCard(ctx, "apple_contact", { emails: ["secondary@example.test"], phones: [] }, false));
    await t.action(sync, {});
    const person = (await t.run(ctx => ctx.db.query("people").collect()))[0];
    await t.mutation(setPrimaryHandleRef, { key: TEST_KEY, personId: person._id, handle: selected });
    state.emails = [];
    await t.action(sync, {});
    const after = await t.run(ctx => ctx.db.get(person._id));
    expect(after?.primary_handle).toBe(selected === "secondary@example.test" ? selected : undefined);
    expect(JSON.stringify(await t.query(listPeopleRef, { key: TEST_KEY }))).not.toContain("imported@example.test");
  });
}

test("unchanged aggregates still clear an unsupported selected primary", async () => {
  const { t } = fixture();
  await t.run(ctx => ingestOneCard(ctx, "apple_contact", { emails: ["secondary@example.test"], phones: [] }, false));
  const person = (await t.run(ctx => ctx.db.query("people").collect()))[0];
  await t.run(ctx => ctx.db.patch(person._id, { primary_handle: "stale@example.test" }));
  await t.run(ctx => ingestOneCard(ctx, "apple_contact", { emails: ["secondary@example.test"], phones: [] }, false));
  expect((await t.run(ctx => ctx.db.get(person._id)))?.primary_handle).toBeUndefined();
});
