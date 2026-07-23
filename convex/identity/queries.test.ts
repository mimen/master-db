import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import {
  listPeopleRef,
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
  }> = {},
): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run((ctx) =>
    ctx.db.insert("people", {
      display_name: overrides.display_name,
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
    expect(results).toEqual([{ normalized: "+16195551111", display_name: "Milad" }]);
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(nameDirectoryRef, { key: "wrong" })).rejects.toThrow();
  });
});
