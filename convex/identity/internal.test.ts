import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import {
  pickPrimaryNameIdentity,
  recomputePersonAggregates,
  upsertIdentityCandidate,
  type IdentityCandidate,
} from "./internal";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

async function seedPerson(
  t: TestConvex<typeof schema>,
  overrides: Partial<{
    display_name: string;
    display_name_locked: boolean;
    first_name: string;
    last_name: string;
    nickname: string;
    organization: string;
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
      first_name: overrides.first_name,
      last_name: overrides.last_name,
      nickname: overrides.nickname,
      organization: overrides.organization,
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
    first_name: string;
    last_name: string;
    nickname: string;
    source: string;
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
      first_name: overrides.first_name,
      last_name: overrides.last_name,
      nickname: overrides.nickname,
      message_count: overrides.message_count ?? 0,
      chat_count: 0,
      is_self: overrides.is_self ?? false,
      source: overrides.source ?? "apple_contact",
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

  test("primary-identity selection: apple_contact outranks airtable_human and manual, taking display/first/last/nickname together", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name_locked: false });
    await seedIdentity(t, personId, {
      value: "manual-1",
      normalized: "manual-1",
      source: "manual",
      display_name: "M Manual",
      first_name: "M",
      last_name: "Manual",
    });
    await seedIdentity(t, personId, {
      value: "airtable-1",
      normalized: "airtable-1",
      source: "airtable_human",
      display_name: "A Airtable",
      first_name: "A",
      last_name: "Airtable",
    });
    await seedIdentity(t, personId, {
      value: "apple-1",
      normalized: "apple-1",
      source: "apple_contact",
      display_name: "Chase P.",
      first_name: "Chase",
      last_name: "Petersen",
      nickname: "Chasey",
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Chase P.");
    expect(person?.first_name).toBe("Chase");
    expect(person?.last_name).toBe("Petersen");
    expect(person?.nickname).toBe("Chasey");
  });

  test("primary-identity selection: airtable_human outranks manual when no apple_contact identity exists", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name_locked: false });
    await seedIdentity(t, personId, {
      value: "manual-1",
      normalized: "manual-1",
      source: "manual",
      display_name: "M Manual",
      first_name: "M",
      last_name: "Manual",
    });
    await seedIdentity(t, personId, {
      value: "airtable-1",
      normalized: "airtable-1",
      source: "airtable_human",
      display_name: "A Airtable",
      first_name: "A",
      last_name: "Airtable",
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("A Airtable");
    expect(person?.first_name).toBe("A");
    expect(person?.last_name).toBe("Airtable");
  });

  test("primary-identity selection: a higher-priority identity with NO name data doesn't outrank a lower-priority one that has a name", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name_locked: false });
    // A manual identity ranks above "participant" (beeper/other), but this
    // one carries no name data at all — e.g. createPerson's orphan-row
    // linking path inserting a nameless placeholder. It must not blank out
    // a lower-priority identity that DOES have a name.
    await seedIdentity(t, personId, { value: "manual-1", normalized: "manual-1", source: "manual" });
    await seedIdentity(t, personId, {
      value: "beeper-1",
      normalized: "beeper-1",
      source: "participant",
      display_name: "From Chat",
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("From Chat");
  });

  test("lock guards all four name fields (display, first, last, nickname) through a sync re-run", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, {
      display_name: "Manually Set Name",
      first_name: "Manually",
      last_name: "Set",
      nickname: "MSN",
      display_name_locked: true,
    });
    await seedIdentity(t, personId, {
      value: "apple-1",
      normalized: "apple-1",
      source: "apple_contact",
      display_name: "Source Derived Name",
      first_name: "Source",
      last_name: "Derived",
      nickname: "SD",
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Manually Set Name");
    expect(person?.first_name).toBe("Manually");
    expect(person?.last_name).toBe("Set");
    expect(person?.nickname).toBe("MSN");
  });

  test("organization survives a sync — recomputePersonAggregates never touches it, set or unset", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, {
      display_name_locked: false,
      organization: "Afternoon Umbrella Friends",
    });
    await seedIdentity(t, personId, {
      value: "apple-1",
      normalized: "apple-1",
      source: "apple_contact",
      display_name: "Chase",
      first_name: "Chase",
    });

    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.organization).toBe("Afternoon Umbrella Friends");
    expect(person?.display_name).toBe("Chase"); // sanity: the sync still ran
  });

  test("CRM fields survive a sync — recomputePersonAggregates never touches is_favorite, priority, or tags", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name_locked: false });
    await t.run((ctx) =>
      ctx.db.patch(personId, { is_favorite: true, priority: "high" as const }),
    );
    await t.run((ctx) =>
      ctx.db.insert("person_tags", {
        person_id: personId,
        tag: "vip",
        created_at: new Date().toISOString(),
      }),
    );
    await seedIdentity(t, personId, {
      value: "apple-1",
      normalized: "apple-1",
      source: "apple_contact",
      display_name: "Chase",
      first_name: "Chase",
    });

    // Simulate a full re-sync: recompute aggregates twice, same as a
    // re-ingest of an unchanged card followed by another.
    await t.run((ctx) => recomputePersonAggregates(ctx, personId));
    await t.run((ctx) => recomputePersonAggregates(ctx, personId));

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.is_favorite).toBe(true);
    expect(person?.priority).toBe("high");
    expect(person?.display_name).toBe("Chase"); // sanity: the sync still ran

    const tags = await t.run((ctx) =>
      ctx.db
        .query("person_tags")
        .withIndex("by_person", (q) => q.eq("person_id", personId))
        .collect(),
    );
    expect(tags.map((t) => t.tag)).toEqual(["vip"]);
  });
});

describe("pickPrimaryNameIdentity", () => {
  test("returns undefined when no candidate has any name data", () => {
    const identities = [{ source: "manual" }, { source: "participant" }];
    expect(pickPrimaryNameIdentity(identities)).toBeUndefined();
  });

  test("ties within the same source rank break on longest display_name", () => {
    const identities = [
      { source: "apple_contact", display_name: "A" },
      { source: "apple_contact", display_name: "A Longer Name" },
    ];
    expect(pickPrimaryNameIdentity(identities)?.display_name).toBe("A Longer Name");
  });

  test("unlisted sources (e.g. beeper's participant/sender) rank below apple/airtable/manual", () => {
    const identities = [
      { source: "participant", display_name: "Beeper Name" },
      { source: "manual", display_name: "Manual Name" },
    ];
    expect(pickPrimaryNameIdentity(identities)?.display_name).toBe("Manual Name");
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
