import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { toContactCard } from "./airtableSync";
import type { CanonicalContact } from "./canonicalContacts";
import { ingestOneCard } from "./ingestContacts";

const id = "recAAAAAAAAAAAAAA";
const record = { id, fields: { Name: "Synthetic Contact", "First Name": "Synthetic" } };
const contacts: CanonicalContact[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ humanId: id, channel: "email" as const, value: `contact${i}@example.test`, primary: i === 0 })),
  ...Array.from({ length: 4 }, (_, i) => ({ humanId: id, channel: "sms" as const, value: `+1619555010${i}`, primary: i === 0 })),
];
const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("canonical Airtable sync", () => {
  test("retains all contacts beyond the old slot count, deduplicates, and isolates Humans", () => {
    const card = toContactCard(record, [...contacts, contacts[0], { ...contacts[0], humanId: "recBBBBBBBBBBBBBB", value: "other@example.test" }]);
    expect(card?.emails).toHaveLength(6);
    expect(card?.phones).toHaveLength(4);
    expect(card?.first_name).toBe("Synthetic");
    expect(card?.airtable_record_id).toBe(id);
    expect(toContactCard(record, [])).toBeNull();
  });
  test("links by a secondary email, enriches all handles, and never seeds unmatched people", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", { emails: ["contact5@example.test"], phones: [] }, false));
    const card = toContactCard(record, contacts)!;
    const result = await t.run((ctx) => ingestOneCard(ctx, "airtable_human", card, true));
    expect(result.outcome).toBe("reused");
    const people = await t.run((ctx) => ctx.db.query("people").collect());
    expect(people).toHaveLength(1);
    expect(people[0].normalized_emails).toContain("contact5@example.test");
    expect(people[0].normalized_phones).toContain("+16195550103");
    await t.run((ctx) => ingestOneCard(ctx, "airtable_human", { emails: ["unmatched@example.test"], phones: [] }, true));
    expect(await t.run((ctx) => ctx.db.query("people").collect())).toHaveLength(1);
  });
  test("actual action uses bounded canonical fetch and link_only ingestion", async () => {
    vi.stubEnv("AIRTABLE_API_KEY", "synthetic");
    vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "synthetic");
    vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("api.airtable.com")) {
        const fields = new URL(String(input)).searchParams.getAll("fields[]");
        expect(fields).toEqual(["Name", "First Name", "Last Name"]);
        return Response.json({ records: [record] });
      }
      expect(JSON.parse(init!.body as string)).toEqual({ humanIds: [id] });
      return Response.json({ contacts });
    });
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", { emails: [], phones: ["+16195550103"] }, false));
    const result = await t.action(makeFunctionReference<"action", Record<string, never>, { peopleReused: number }>("identity/airtableSync:syncAirtableHumans"), {});
    expect(result.peopleReused).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await t.run((ctx) => ctx.db.query("people").collect())).toHaveLength(1);
  });
  test("a later canonical read failure prevents partial identity writes", async () => {
    vi.stubEnv("AIRTABLE_API_KEY", "synthetic");
    vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "synthetic");
    vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
    let pages = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      if (String(input).includes("api.airtable.com"))
        return Response.json({ records: [record], ...(pages++ === 0 ? { offset: "next" } : {}) });
      return pages === 1 ? Response.json({ contacts }) : new Response("private", { status: 503 });
    }));
    const t = convexTest(schema, modules);
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", { emails: [], phones: ["+16195550103"] }, false));
    await expect(t.action(makeFunctionReference<"action", Record<string, never>>("identity/airtableSync:syncAirtableHumans"), {})).rejects.toThrow("AUF canonical contact read failed: 503");
    const people = await t.run((ctx) => ctx.db.query("people").collect());
    expect(people).toHaveLength(1);
    expect(people[0].airtable_human_id).toBeUndefined();
    expect(people[0].normalized_emails).toEqual([]);
  });

});
