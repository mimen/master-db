import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { migratePersonTagsRef, migratePriorityToNumericRef, TEST_KEY } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});

async function seedPerson(
  t: TestConvex<typeof schema>,
  overrides: Partial<{ display_name: string; priority: number | string }> = {},
): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run((ctx) =>
    ctx.db.insert("people", {
      display_name: overrides.display_name,
      // Priority's transitional schema type accepts both forms during the
      // migration window — see schema/identity/people.ts's docstring.
      priority: overrides.priority as never,
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

describe("migratePriorityToNumeric", () => {
  test("maps high→2, normal→3, low→4", async () => {
    const t = convexTest(schema, modules);
    const high = await seedPerson(t, { priority: "high" });
    const normal = await seedPerson(t, { priority: "normal" });
    const low = await seedPerson(t, { priority: "low" });

    const result = await t.mutation(migratePriorityToNumericRef, {});
    expect(result).toEqual({ scanned: 3, migrated: 3, alreadyNumeric: 0, unset: 0, unrecognized: 0 });

    expect((await t.run((ctx) => ctx.db.get(high)))?.priority).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(normal)))?.priority).toBe(3);
    expect((await t.run((ctx) => ctx.db.get(low)))?.priority).toBe(4);
  });

  test("idempotent: re-running after a full migration reports zero migrated", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, { priority: "high" });
    await t.mutation(migratePriorityToNumericRef, {});

    const second = await t.mutation(migratePriorityToNumericRef, {});
    expect(second.migrated).toBe(0);
    expect(second.alreadyNumeric).toBe(1);
  });

  test("leaves already-numeric and unset rows untouched, counted separately", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, { priority: 5 });
    await seedPerson(t, {});

    const result = await t.mutation(migratePriorityToNumericRef, {});
    expect(result).toEqual({ scanned: 2, migrated: 0, alreadyNumeric: 1, unset: 1, unrecognized: 0 });
  });

  test("never touches chat_crm or event_links — no sync path clobbers chat CRM", async () => {
    const t = convexTest(schema, modules);
    await seedPerson(t, { priority: "high" });
    const now = new Date().toISOString();
    await t.run((ctx) =>
      ctx.db.insert("chat_crm", { chat_guid: "g1", is_favorite: true, priority: 1, created_at: now, updated_at: now }),
    );

    await t.mutation(migratePriorityToNumericRef, {});

    const chatRow = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", "g1")).first(),
    );
    expect(chatRow?.is_favorite).toBe(true);
    expect(chatRow?.priority).toBe(1);
  });
});

describe("migratePersonTags", () => {
  test("copies person_tags rows into the unified tags table", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase" });
    await t.run((ctx) =>
      ctx.db.insert("person_tags", { person_id: personId, tag: "vip", created_at: new Date().toISOString() }),
    );

    const result = await t.mutation(migratePersonTagsRef, {});
    expect(result).toEqual({ scanned: 1, migrated: 1, alreadyPresent: 0 });

    const rows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(rows.map((r) => r.tag)).toEqual(["vip"]);
  });

  test("idempotent: re-running skips rows already present in tags", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase" });
    await t.run((ctx) =>
      ctx.db.insert("person_tags", { person_id: personId, tag: "vip", created_at: new Date().toISOString() }),
    );
    await t.mutation(migratePersonTagsRef, {});

    const second = await t.mutation(migratePersonTagsRef, {});
    expect(second).toEqual({ scanned: 1, migrated: 0, alreadyPresent: 1 });

    const rows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(rows).toHaveLength(1);
  });

  test("never touches chat tags — a pre-existing chat tag survives the migration untouched", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("tags", { chat_guid: "g1", tag: "planning", created_at: new Date().toISOString() }),
    );

    await t.mutation(migratePersonTagsRef, {});

    const rows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", "g1")).collect(),
    );
    expect(rows.map((r) => r.tag)).toEqual(["planning"]);
  });
});
