import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import {
  listPeopleRef,
  listTagsRef,
  nameDirectoryRef,
  searchPeopleRef,
  topLinkedPeopleRef,
  TEST_KEY,
  whoIsRef,
} from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});

async function seedPerson(
  t: TestConvex<typeof schema>,
  overrides: Partial<{
    display_name: string;
    is_self: boolean;
    merged_into: Id<"people">;
    identity_count: number;
    normalized_phones: string[];
    normalized_emails: string[];
    first_name: string;
    last_name: string;
    nickname: string;
    organization: string;
    is_favorite: boolean;
    priority: "high" | "normal" | "low";
  }> = {},
): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run((ctx) =>
    ctx.db.insert("people", {
      display_name: overrides.display_name,
      first_name: overrides.first_name,
      last_name: overrides.last_name,
      nickname: overrides.nickname,
      organization: overrides.organization,
      is_favorite: overrides.is_favorite,
      priority: overrides.priority,
      normalized_phones: overrides.normalized_phones ?? [],
      normalized_emails: overrides.normalized_emails ?? [],
      identity_count: overrides.identity_count ?? 0,
      message_count: 0,
      is_self: overrides.is_self ?? false,
      auto_clustered: true,
      merged_into: overrides.merged_into,
      created_at: now,
      updated_at: now,
    }),
  );
}

async function seedTag(t: TestConvex<typeof schema>, personId: Id<"people">, tag: string): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("person_tags", { person_id: personId, tag, created_at: new Date().toISOString() }),
  );
}

async function seedIdentity(
  t: TestConvex<typeof schema>,
  personId: Id<"people"> | undefined,
  overrides: Partial<{ value: string; normalized: string; source: string; display_name: string }> = {},
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
      message_count: 0,
      chat_count: 0,
      is_self: false,
      source: overrides.source ?? "apple_contact",
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    }),
  );
}

describe("whoIs", () => {
  test("not found when no identity row exists for the normalized handle", async () => {
    const t = convexTest(schema, modules);
    const result = (await t.query(whoIsRef, { key: TEST_KEY, handle: "6195551234" })) as {
      found: boolean;
    };
    expect(result.found).toBe(false);
  });

  test("finds the person even when the first normalized row lacks a person_id and a later one has it", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase" });
    // Unresolved row inserted first (by_normalized index has no ordering
    // guarantee tied to insertion order, but this reproduces the bug: a
    // `.first()` call could easily land on this row).
    await seedIdentity(t, undefined, { source: "participant" });
    await seedIdentity(t, personId, { source: "apple_contact" });

    const result = (await t.query(whoIsRef, { key: TEST_KEY, handle: "6195551234" })) as {
      found: boolean;
      person?: { _id: Id<"people"> };
    };
    expect(result.found).toBe(true);
    expect(result.person?._id).toBe(personId);
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(whoIsRef, { key: "wrong", handle: "6195551234" })).rejects.toThrow();
  });

  test("includes is_favorite/priority (riding along on the raw person doc) and tags (joined separately)", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase", is_favorite: true, priority: "high" });
    await seedIdentity(t, personId, { source: "apple_contact" });
    await seedTag(t, personId, "vip");
    await seedTag(t, personId, "family");

    const result = (await t.query(whoIsRef, { key: TEST_KEY, handle: "6195551234" })) as {
      found: boolean;
      person?: { is_favorite?: boolean; priority?: string };
      tags?: string[];
    };
    expect(result.found).toBe(true);
    expect(result.person?.is_favorite).toBe(true);
    expect(result.person?.priority).toBe("high");
    expect(result.tags).toEqual(["family", "vip"]);
  });

  test("tags is an empty array for a person with none", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase" });
    await seedIdentity(t, personId, { source: "apple_contact" });

    const result = (await t.query(whoIsRef, { key: TEST_KEY, handle: "6195551234" })) as {
      tags?: string[];
    };
    expect(result.tags).toEqual([]);
  });
});

describe("searchPeople", () => {
  test("case-insensitive substring match, excludes merged-away people", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, { display_name: "Milad Imen" });
    const merged = await seedPerson(t, { display_name: "Ghost" });
    await seedPerson(t, { display_name: "Ghost Two", merged_into: merged });

    const results = (await t.query(searchPeopleRef, { key: TEST_KEY, name: "milad" })) as Array<{
      display_name?: string;
    }>;
    expect(results.map((r) => r.display_name)).toEqual(["Milad Imen"]);
  });
});

describe("listPeople", () => {
  test("excludes unnamed, self, and merged-away people; sorts alphabetically", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, { display_name: "Chase" });
    await seedPerson(t, { display_name: undefined });
    await seedPerson(t, { display_name: "Alex" });
    await seedPerson(t, { display_name: "Milad", is_self: true });
    const mergeTarget = await seedPerson(t, { display_name: undefined });
    await seedPerson(t, { display_name: "Ghost", merged_into: mergeTarget });

    const results = (await t.query(listPeopleRef, { key: TEST_KEY })) as Array<{
      display_name?: string;
    }>;
    expect(results.map((r) => r.display_name)).toEqual(["Alex", "Chase"]);
  });

  test("projects is_favorite, priority, and tags per person", async () => {
    const t = convexTest(schema, modules);
    const alex = await seedPerson(t, { display_name: "Alex", is_favorite: true });
    await seedPerson(t, { display_name: "Chase", priority: "low" });
    await seedTag(t, alex, "vip");

    const results = (await t.query(listPeopleRef, { key: TEST_KEY })) as Array<{
      display_name?: string;
      is_favorite?: boolean;
      priority?: string;
      tags: string[];
    }>;
    const alexRow = results.find((r) => r.display_name === "Alex");
    const chaseRow = results.find((r) => r.display_name === "Chase");
    expect(alexRow?.is_favorite).toBe(true);
    expect(alexRow?.tags).toEqual(["vip"]);
    expect(chaseRow?.priority).toBe("low");
    expect(chaseRow?.tags).toEqual([]);
  });
});

describe("listTags", () => {
  test("returns distinct tags with counts, sorted by count desc then alphabetically", async () => {
    const t = convexTest(schema, modules);
    const a = await seedPerson(t, { display_name: "A" });
    const b = await seedPerson(t, { display_name: "B" });
    const c = await seedPerson(t, { display_name: "C" });
    await seedTag(t, a, "vip");
    await seedTag(t, b, "vip");
    await seedTag(t, c, "vip");
    await seedTag(t, a, "family");
    await seedTag(t, b, "family");
    await seedTag(t, a, "work");

    const results = await t.query(listTagsRef, { key: TEST_KEY });
    expect(results).toEqual([
      { tag: "vip", count: 3 },
      { tag: "family", count: 2 },
      { tag: "work", count: 1 },
    ]);
  });

  test("empty when no tags exist", async () => {
    const t = convexTest(schema, modules);
    const results = await t.query(listTagsRef, { key: TEST_KEY });
    expect(results).toEqual([]);
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(listTagsRef, { key: "wrong" })).rejects.toThrow();
  });
});

describe("topLinkedPeople", () => {
  test("excludes merged-away and singletons, sorts desc, respects limit", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, { display_name: "A", identity_count: 1 });
    await seedPerson(t, { display_name: "B", identity_count: 3 });
    const mergedTarget = await seedPerson(t, { display_name: "target" });
    await seedPerson(t, { display_name: "C", identity_count: 5, merged_into: mergedTarget });
    await seedPerson(t, { display_name: "D", identity_count: 2 });

    const results = (await t.query(topLinkedPeopleRef, { key: TEST_KEY, limit: 1 })) as Array<{
      display_name?: string;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.display_name).toBe("B");
  });

  test("default limit is 25", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 30; i++) {
      await seedPerson(t, { display_name: `P${i}`, identity_count: 2 });
    }
    const results = (await t.query(topLinkedPeopleRef, { key: TEST_KEY })) as unknown[];
    expect(results).toHaveLength(25);
  });
});

describe("nameDirectory", () => {
  test("flattens normalized phones and emails, one entry per handle", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, {
      display_name: "Alex",
      normalized_phones: ["+16195551234", "+16195555678"],
      normalized_emails: ["alex@example.com"],
    });

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.normalized))).toEqual(
      new Set(["+16195551234", "+16195555678", "alex@example.com"]),
    );
    expect(results.every((r) => r.display_name === "Alex")).toBe(true);
  });

  test("excludes merged-away people and people without a display_name", async () => {
    const t = convexTest(schema, modules);
    const target = await seedPerson(t, { display_name: "Target" });
    await seedPerson(t, {
      display_name: "Ghost",
      merged_into: target,
      normalized_phones: ["+16195559999"],
    });
    await seedPerson(t, { normalized_phones: ["+16195550000"] }); // no display_name

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toEqual([]);
  });

  test("includes is_self people", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, {
      display_name: "Milad",
      is_self: true,
      normalized_phones: ["+16195551111"],
    });

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toEqual([{ normalized: "+16195551111", display_name: "Milad", terms: ["milad"] }]);
  });

  test("terms include display name, first, last, nickname, organization, and the combined full name — deduped and lowercased", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, {
      display_name: "Uncle Jimmy",
      first_name: "Jimmy",
      last_name: "Sciandra",
      nickname: "Uncle Jimmy",
      organization: "Pluto Sound",
      normalized_phones: ["+16195551234"],
    });

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toHaveLength(1);
    const terms = results[0]?.terms ?? [];
    expect(new Set(terms)).toEqual(
      new Set(["uncle jimmy", "jimmy", "sciandra", "pluto sound", "jimmy sciandra"]),
    );
    // Deduped: nickname equals display_name, so "uncle jimmy" appears once.
    expect(terms.filter((term) => term === "uncle jimmy")).toHaveLength(1);
  });

  test("omits blank fields from terms", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, {
      display_name: "SoloName",
      normalized_phones: ["+16195552222"],
    });

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toEqual([{ normalized: "+16195552222", display_name: "SoloName", terms: ["soloname"] }]);
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(nameDirectoryRef, { key: "wrong" })).rejects.toThrow();
  });
});
