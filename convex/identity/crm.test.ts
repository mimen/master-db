import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { addTagRef, removeTagRef, setFavoriteRef, setPriorityRef, TEST_KEY } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});

async function seedPerson(t: TestConvex<typeof schema>): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run((ctx) =>
    ctx.db.insert("people", {
      display_name: "Chase Petersen",
      normalized_phones: [],
      normalized_emails: [],
      identity_count: 0,
      message_count: 0,
      is_self: false,
      auto_clustered: true,
      created_at: now,
      updated_at: now,
    }),
  );
}

describe("setFavorite", () => {
  test("sets is_favorite true on a never-favorited person", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: true });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.is_favorite).toBe(true);
  });

  test("clears is_favorite back to false", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: true });
    await t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: false });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.is_favorite).toBe(false);
  });

  test("no-op: setting false on a never-favorited person doesn't bump updated_at", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    const before = await t.run((ctx) => ctx.db.get(personId));
    await t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: false });
    const after = await t.run((ctx) => ctx.db.get(personId));
    expect(after?.updated_at).toBe(before?.updated_at);
    expect(after?.is_favorite).toBeUndefined();
  });

  test("no-op: setting true twice in a row only bumps updated_at once", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: true });
    const afterFirst = await t.run((ctx) => ctx.db.get(personId));
    await t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: true });
    const afterSecond = await t.run((ctx) => ctx.db.get(personId));
    expect(afterSecond?.updated_at).toBe(afterFirst?.updated_at);
  });

  test("throws on an unknown person", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.run((ctx) => ctx.db.delete(personId));
    await expect(
      t.mutation(setFavoriteRef, { key: TEST_KEY, personId, is_favorite: true }),
    ).rejects.toThrow("Person not found");
  });
});

describe("setPriority", () => {
  test("sets priority to a literal", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: "high" });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.priority).toBe("high");
  });

  test("null clears priority back to unset (not 'normal')", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: "high" });
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: null });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.priority).toBeUndefined();
  });

  test("omitting priority also clears it", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: "low" });
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.priority).toBeUndefined();
  });

  test("no-op: clearing an already-unset priority doesn't bump updated_at", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    const before = await t.run((ctx) => ctx.db.get(personId));
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: null });
    const after = await t.run((ctx) => ctx.db.get(personId));
    expect(after?.updated_at).toBe(before?.updated_at);
  });

  test("no-op: setting the same literal twice only bumps updated_at once", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: "normal" });
    const afterFirst = await t.run((ctx) => ctx.db.get(personId));
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: "normal" });
    const afterSecond = await t.run((ctx) => ctx.db.get(personId));
    expect(afterSecond?.updated_at).toBe(afterFirst?.updated_at);
  });
});

describe("addTag / removeTag", () => {
  test("adds a trimmed, lowercased tag", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "  VIP  " });
    const tags = await t.run((ctx) =>
      ctx.db.query("person_tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(tags.map((tg) => tg.tag)).toEqual(["vip"]);
  });

  test("dedupes: adding the same tag twice (different case/whitespace) only creates one row", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "vip" });
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "  VIP" });
    const tags = await t.run((ctx) =>
      ctx.db.query("person_tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(tags).toHaveLength(1);
  });

  test("a person can carry multiple distinct tags", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "vip" });
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "family" });
    const tags = await t.run((ctx) =>
      ctx.db.query("person_tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(tags.map((tg) => tg.tag).sort()).toEqual(["family", "vip"]);
  });

  test("rejects an all-whitespace tag", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await expect(t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "   " })).rejects.toThrow(
      "Tag can't be empty",
    );
  });

  test("removeTag deletes the matching row", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "vip" });
    await t.mutation(removeTagRef, { key: TEST_KEY, personId, tag: "VIP" });
    const tags = await t.run((ctx) =>
      ctx.db.query("person_tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(tags).toHaveLength(0);
  });

  test("removeTag no-ops cleanly when the tag isn't present", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await expect(
      t.mutation(removeTagRef, { key: TEST_KEY, personId, tag: "nope" }),
    ).resolves.toBeNull();
  });

  test("tags are scoped per person — adding to one person doesn't affect another", async () => {
    const t = convexTest(schema, modules);
    const personA = await seedPerson(t);
    const personB = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId: personA, tag: "vip" });
    const tagsB = await t.run((ctx) =>
      ctx.db.query("person_tags").withIndex("by_person", (q) => q.eq("person_id", personB)).collect(),
    );
    expect(tagsB).toHaveLength(0);
  });
});
