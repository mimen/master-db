import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { recomputePersonAggregates, upsertIdentityCandidate, type IdentityCandidate } from "./internal";

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

function candidate(overrides: Partial<IdentityCandidate> = {}): IdentityCandidate {
  return {
    network: "whatsapp",
    value: "+16195551234@s.whatsapp.net",
    kind: "whatsapp",
    normalized: "+16195551234",
    is_self: false,
    source: "participant",
    chat_count: 1,
    ...overrides,
  };
}

async function getIdentityByValue(t: TestConvex<typeof schema>, value: string) {
  return t.run((ctx) =>
    ctx.db
      .query("identities")
      .withIndex("by_value", (q) => q.eq("value", value))
      .first(),
  );
}

describe("upsertIdentityCandidate", () => {
  test("re-run idempotency: identical input twice yields identical chat_count and no updated_at churn", async () => {
    const t = convexTest(schema, modules);
    const c = candidate({ chat_count: 3, display_name: "Chase", last_seen_at: "2026-01-01T00:00:00.000Z" });

    const firstOutcome = await t.run((ctx) => upsertIdentityCandidate(ctx, c));
    expect(firstOutcome).toBe("inserted");
    const afterFirst = await getIdentityByValue(t, c.value);
    expect(afterFirst?.chat_count).toBe(3);

    await new Promise((r) => setTimeout(r, 5));
    const secondOutcome = await t.run((ctx) => upsertIdentityCandidate(ctx, c));
    expect(secondOutcome).toBe("unchanged");
    const afterSecond = await getIdentityByValue(t, c.value);

    expect(afterSecond?.chat_count).toBe(3);
    expect(afterSecond?.updated_at).toBe(afterFirst?.updated_at);
  });

  test("a later run with fewer appearances sets chat_count DOWN, not up", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ chat_count: 5 })));
    const afterFirst = await getIdentityByValue(t, "+16195551234@s.whatsapp.net");
    expect(afterFirst?.chat_count).toBe(5);

    const outcome = await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ chat_count: 2 })));
    expect(outcome).toBe("updated");
    const afterSecond = await getIdentityByValue(t, "+16195551234@s.whatsapp.net");
    expect(afterSecond?.chat_count).toBe(2);
  });

  test("longer display_name wins on update", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ display_name: "Chase" })));
    await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ display_name: "C" })));
    const after = await getIdentityByValue(t, "+16195551234@s.whatsapp.net");
    expect(after?.display_name).toBe("Chase");

    await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ display_name: "Chase Petersen" })));
    const after2 = await getIdentityByValue(t, "+16195551234@s.whatsapp.net");
    expect(after2?.display_name).toBe("Chase Petersen");
  });

  test("last_seen_at only advances, never regresses", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      upsertIdentityCandidate(ctx, candidate({ last_seen_at: "2026-01-10T00:00:00.000Z" })),
    );
    await t.run((ctx) =>
      upsertIdentityCandidate(ctx, candidate({ last_seen_at: "2026-01-01T00:00:00.000Z" })),
    );
    const after = await getIdentityByValue(t, "+16195551234@s.whatsapp.net");
    expect(after?.last_seen_at).toBe("2026-01-10T00:00:00.000Z");
  });

  test("is_self is sticky once true", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ is_self: true })));
    await t.run((ctx) => upsertIdentityCandidate(ctx, candidate({ is_self: false })));
    const after = await getIdentityByValue(t, "+16195551234@s.whatsapp.net");
    expect(after?.is_self).toBe(true);
  });

  test("distinct (network, value) pairs are independent rows", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      upsertIdentityCandidate(ctx, candidate({ network: "whatsapp", value: "shared-id", chat_count: 1 })),
    );
    await t.run((ctx) =>
      upsertIdentityCandidate(ctx, candidate({ network: "imessage", value: "shared-id", chat_count: 1 })),
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "shared-id"))
        .collect(),
    );
    expect(rows).toHaveLength(2);
  });
});
