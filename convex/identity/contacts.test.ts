import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import {
  addHandleRef,
  linkEventRef,
  markNotDuplicateRef,
  mergePeopleRef,
  setNotesRef,
  setPrimaryHandleRef,
  TEST_KEY,
} from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});

type Seed = { name: string; phone?: string; email?: string; org?: string; priority?: number; favorite?: boolean; notes?: string };

async function seed(t: TestConvex<typeof schema>, s: Seed): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      display_name: s.name,
      organization: s.org,
      priority: s.priority,
      is_favorite: s.favorite,
      notes: s.notes,
      normalized_phones: s.phone ? [s.phone] : [],
      normalized_emails: s.email ? [s.email] : [],
      identity_count: 0,
      message_count: 0,
      is_self: false,
      auto_clustered: true,
      created_at: now,
      updated_at: now,
    });
    for (const [kind, value] of [["phone", s.phone], ["email", s.email]] as const) {
      if (!value) continue;
      await ctx.db.insert("identities", {
        person_id: personId, kind, value, normalized: value, display_name: s.name,
        message_count: kind === "phone" ? 10 : 2, chat_count: 1, is_self: false, source: "apple_contact",
        created_at: now, updated_at: now,
      });
    }
    return personId;
  });
}

describe("setPrimaryHandle", () => {
  test("stores the normalized handle", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { name: "Tracy", phone: "+15550142298", email: "tracy@x.example" });
    await t.mutation(setPrimaryHandleRef, { key: TEST_KEY, personId: id, handle: "Tracy@X.example" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.primary_handle).toBe("tracy@x.example");
  });

  test("refuses a handle the person doesn't have", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { name: "Tracy", phone: "+15550142298" });
    await expect(t.mutation(setPrimaryHandleRef, { key: TEST_KEY, personId: id, handle: "+15550000000" }))
      .rejects.toThrow("doesn't belong");
  });

  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { name: "Tracy", phone: "+15550142298" });
    await expect(t.mutation(setPrimaryHandleRef, { key: "wrong", personId: id, handle: "+15550142298" })).rejects.toThrow();
  });
});

describe("addHandle", () => {
  test("adds a new phone and recomputes the person's handles", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { name: "Rae", phone: "+15550100000" });
    await t.mutation(addHandleRef, { key: TEST_KEY, personId: id, handle: "(555) 017-6620" });
    const person = await t.run((ctx) => ctx.db.get(id));
    expect(person?.normalized_phones.sort()).toEqual(["+15550100000", "+15550176620"]);
  });

  test("refuses a handle owned by another live person", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { name: "A", phone: "+15550100001" });
    await seed(t, { name: "B", phone: "+15550100002" });
    await expect(t.mutation(addHandleRef, { key: TEST_KEY, personId: a, handle: "+15550100002" }))
      .rejects.toThrow("another contact");
  });
});

describe("mergePeople", () => {
  test("moves identities, tags and events to the kept person and tombstones the other", async () => {
    const t = convexTest(schema, modules);
    const keep = await seed(t, { name: "Dani Okafor", phone: "+15550113390", org: "Okafor Studio", priority: 3 });
    const gone = await seed(t, { name: "Dani O", phone: "+15550190042", priority: 2, favorite: true, notes: "Met at load-in" });
    await t.run(async (ctx) => {
      const now = new Date().toISOString();
      await ctx.db.insert("tags", { person_id: keep, tag: "design", created_at: now });
      await ctx.db.insert("tags", { person_id: gone, tag: "design", created_at: now });
      await ctx.db.insert("tags", { person_id: gone, tag: "showcase", created_at: now });
    });
    await t.mutation(linkEventRef, { key: TEST_KEY, personId: gone, airtable_event_id: "evt1", event_name: "Showcase" });

    await t.mutation(mergePeopleRef, { key: TEST_KEY, keepId: keep, mergeId: gone });

    const [kept, tomb, tags, events] = await t.run(async (ctx) => [
      await ctx.db.get(keep),
      await ctx.db.get(gone),
      (await ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", keep)).collect()).map((r) => r.tag).sort(),
      await ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", keep)).collect(),
    ] as const);
    expect(kept?.display_name).toBe("Dani Okafor");
    expect(kept?.organization).toBe("Okafor Studio");
    expect(kept?.normalized_phones.sort()).toEqual(["+15550113390", "+15550190042"]);
    expect(kept?.message_count).toBe(20);
    expect(kept?.priority).toBe(2);
    expect(kept?.is_favorite).toBe(true);
    expect(kept?.notes).toBe("Met at load-in");
    expect(tags).toEqual(["design", "showcase"]);
    expect(events).toHaveLength(1);
    expect(tomb?.merged_into).toBe(keep);
    expect(tomb?.normalized_phones).toEqual([]);
  });

  test("refuses to merge a person into itself", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { name: "Solo", phone: "+15550100009" });
    await expect(t.mutation(mergePeopleRef, { key: TEST_KEY, keepId: id, mergeId: id })).rejects.toThrow();
  });
});

describe("markNotDuplicate", () => {
  test("records the pair on both people, once", async () => {
    const t = convexTest(schema, modules);
    const a = await seed(t, { name: "Dani Okafor", phone: "+15550100011" });
    const b = await seed(t, { name: "Dani Okafor", phone: "+15550100012" });
    await t.mutation(markNotDuplicateRef, { key: TEST_KEY, personId: a, otherId: b });
    await t.mutation(markNotDuplicateRef, { key: TEST_KEY, personId: b, otherId: a });
    const [pa, pb] = await t.run(async (ctx) => [await ctx.db.get(a), await ctx.db.get(b)] as const);
    expect(pa?.not_duplicate_of).toEqual([b]);
    expect(pb?.not_duplicate_of).toEqual([a]);
  });
});

describe("setNotes", () => {
  test("sets, stamps and clears notes", async () => {
    const t = convexTest(schema, modules);
    const id = await seed(t, { name: "Tracy", phone: "+15550142298" });
    await t.mutation(setNotesRef, { key: TEST_KEY, personId: id, notes: "  Runs the showcase.  " });
    let person = await t.run((ctx) => ctx.db.get(id));
    expect(person?.notes).toBe("Runs the showcase.");
    expect(person?.notes_updated_at).toBeTruthy();
    await t.mutation(setNotesRef, { key: TEST_KEY, personId: id, notes: " " });
    person = await t.run((ctx) => ctx.db.get(id));
    expect(person?.notes).toBeUndefined();
  });
});
