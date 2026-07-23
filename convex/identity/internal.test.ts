import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { recomputePersonAggregates } from "./internal";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

async function seedPerson(
  t: TestConvex<typeof schema>,
  overrides: Partial<{
    display_name: string;
    display_name_locked: boolean;
    normalized_phones: string[];
    normalized_emails: string[];
    identity_count: number;
    message_count: number;
    is_self: boolean;
  }> = {},
): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run((ctx) =>
    ctx.db.insert("people", {
      display_name: overrides.display_name,
      display_name_locked: overrides.display_name_locked,
      normalized_phones: overrides.normalized_phones ?? [],
      normalized_emails: overrides.normalized_emails ?? [],
      identity_count: overrides.identity_count ?? 0,
      message_count: overrides.message_count ?? 0,
      is_self: overrides.is_self ?? false,
      auto_clustered: true,
      created_at: now,
      updated_at: now,
    }),
  );
}

async function seedIdentity(
  t: TestConvex<typeof schema>,
  personId: Id<"people">,
  overrides: Partial<{
    value: string;
    normalized: string;
    display_name: string;
    message_count: number;
    is_self: boolean;
  }> = {},
): Promise<void> {
  const now = new Date().toISOString();
  await t.run((ctx) =>
    ctx.db.insert("identities", {
      person_id: personId,
      kind: "phone",
      value: overrides.value ?? "+16195551234",
      normalized: overrides.normalized ?? "+16195551234",
      network: undefined,
      display_name: overrides.display_name,
      message_count: overrides.message_count ?? 0,
      chat_count: 0,
      is_self: overrides.is_self ?? false,
      source: "apple_contact",
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    }),
  );
}

describe("recomputePersonAggregates", () => {
  test("unlocked person: display_name becomes the longest identity name; phones/emails/counts recomputed", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name_locked: false });
    await seedIdentity(t, personId, {
      value: "+16195551234",
      normalized: "+16195551234",
      display_name: "Chase",
      message_count: 3,
    });
    await seedIdentity(t, personId, {
      value: "chase@example.com",
      normalized: "chase@example.com",
      display_name: "Chase Petersen",
      message_count: 5,
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Chase Petersen");
    expect(person?.normalized_phones).toEqual(["+16195551234"]);
    expect(person?.normalized_emails).toEqual(["chase@example.com"]);
    expect(person?.identity_count).toBe(2);
    expect(person?.message_count).toBe(8);
  });

  test("locked person: display_name is preserved while phones/emails/counts still update", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, {
      display_name: "Manually Set Name",
      display_name_locked: true,
    });
    await seedIdentity(t, personId, {
      value: "+16195551234",
      normalized: "+16195551234",
      display_name: "Some Longer Source-Derived Name",
      message_count: 4,
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Manually Set Name");
    expect(person?.normalized_phones).toEqual(["+16195551234"]);
    expect(person?.message_count).toBe(4);
  });

  test("no-op when aggregates are unchanged: updated_at is not bumped (churn regression)", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name_locked: false });
    await seedIdentity(t, personId, { display_name: "Chase", message_count: 1 });
    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const after1 = await t.run((ctx) => ctx.db.get(personId));
    // Advance the clock so a real bump would be detectable.
    await new Promise((r) => setTimeout(r, 5));
    await t.run((ctx) => recomputePersonAggregates(ctx, personId));
    const after2 = await t.run((ctx) => ctx.db.get(personId));

    expect(after2?.updated_at).toBe(after1?.updated_at);
  });

  test("phones/emails are compared as sets — reinserting in a different order doesn't churn", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, {
      display_name_locked: false,
      normalized_phones: ["+19995551234", "+16195551234"],
      normalized_emails: [],
      identity_count: 2,
      display_name: "Chase",
    });
    await seedIdentity(t, personId, { value: "a", normalized: "+16195551234", display_name: "Chase" });
    await seedIdentity(t, personId, { value: "b", normalized: "+19995551234" });

    const before = await t.run((ctx) => ctx.db.get(personId));
    await t.run((ctx) => recomputePersonAggregates(ctx, personId));
    const after = await t.run((ctx) => ctx.db.get(personId));
    expect(after?.updated_at).toBe(before?.updated_at);
  });
});
