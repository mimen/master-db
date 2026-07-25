import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { clampPriority } from "./crm";
import {
  addChatTagRef,
  addTagRef,
  removeChatTagRef,
  removeTagRef,
  setChatFavoriteRef,
  setChatPriorityRef,
  setFavoriteRef,
  setPriorityRef,
  TEST_KEY,
} from "./testRefs.vitest";

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

describe("clampPriority", () => {
  test("passes 1-5 through unchanged", () => {
    for (let n = 1; n <= 5; n++) expect(clampPriority(n)).toBe(n);
  });

  test("clamps below 1 up to 1, above 5 down to 5", () => {
    expect(clampPriority(0)).toBe(1);
    expect(clampPriority(-10)).toBe(1);
    expect(clampPriority(6)).toBe(5);
    expect(clampPriority(100)).toBe(5);
  });

  test("rounds fractional input", () => {
    expect(clampPriority(2.4)).toBe(2);
    expect(clampPriority(2.6)).toBe(3);
  });
});

describe("setPriority", () => {
  test("sets priority to a numeric level (1 = highest)", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: 1 });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.priority).toBe(1);
  });

  test("clamps an out-of-range value into 1-5", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: 9 });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.priority).toBe(5);
  });

  test("null clears priority back to unset (not a default level)", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: 1 });
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: null });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.priority).toBeUndefined();
  });

  test("omitting priority also clears it", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: 4 });
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

  test("no-op: setting the same level twice only bumps updated_at once", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: 3 });
    const afterFirst = await t.run((ctx) => ctx.db.get(personId));
    await t.mutation(setPriorityRef, { key: TEST_KEY, personId, priority: 3 });
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
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(tags.map((tg) => tg.tag)).toEqual(["vip"]);
  });

  test("dedupes: adding the same tag twice (different case/whitespace) only creates one row", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "vip" });
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "  VIP" });
    const tags = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(tags).toHaveLength(1);
  });

  test("a person can carry multiple distinct tags", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "vip" });
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "family" });
    const tags = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
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
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
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
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personB)).collect(),
    );
    expect(tagsB).toHaveLength(0);
  });
});

describe("setChatFavorite", () => {
  const GUID = "iMessage;-;+16195551234";

  test("sets is_favorite true on a chat with no chat_crm row yet (lazy create)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: GUID, is_favorite: true });
    const rows = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_favorite).toBe(true);
  });

  test("no-op: setting false on a chat with no row yet doesn't create one", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: GUID, is_favorite: false });
    const rows = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("clears is_favorite back to false on an existing row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: GUID, is_favorite: true });
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: GUID, is_favorite: false });
    const rows = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(rows[0]?.is_favorite).toBe(false);
  });

  test("no-op: setting true twice only bumps updated_at once", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: GUID, is_favorite: true });
    const row = () =>
      t.run((ctx) => ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).first());
    const afterFirst = await row();
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: GUID, is_favorite: true });
    const afterSecond = await row();
    expect(afterSecond?.updated_at).toBe(afterFirst?.updated_at);
  });
});

describe("setChatPriority", () => {
  const GUID = "iMessage;-;+16195559999";

  test("sets a chat's priority, clamped 1-5, lazily creating the row", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatPriorityRef, { key: TEST_KEY, chatGuid: GUID, priority: 12 });
    const row = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).first(),
    );
    expect(row?.priority).toBe(5);
  });

  test("no-op: clearing an unset priority on a chat with no row doesn't create one", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatPriorityRef, { key: TEST_KEY, chatGuid: GUID, priority: null });
    const rows = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("null clears an existing priority back to unset", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatPriorityRef, { key: TEST_KEY, chatGuid: GUID, priority: 1 });
    await t.mutation(setChatPriorityRef, { key: TEST_KEY, chatGuid: GUID, priority: null });
    const row = await t.run((ctx) =>
      ctx.db.query("chat_crm").withIndex("by_chat_guid", (q) => q.eq("chat_guid", GUID)).first(),
    );
    expect(row?.priority).toBeUndefined();
  });
});

describe("addChatTag / removeChatTag", () => {
  const GUID = "iMessage;+;chat123456";

  test("adds a trimmed, lowercased tag to a chat", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(addChatTagRef, { key: TEST_KEY, chatGuid: GUID, tag: "  Planning  " });
    const rows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(rows.map((r) => r.tag)).toEqual(["planning"]);
    expect(rows[0]?.person_id).toBeUndefined();
  });

  test("removeChatTag deletes the matching row, no-ops when absent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(addChatTagRef, { key: TEST_KEY, chatGuid: GUID, tag: "planning" });
    await t.mutation(removeChatTagRef, { key: TEST_KEY, chatGuid: GUID, tag: "PLANNING" });
    const rows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(rows).toHaveLength(0);
    await expect(
      t.mutation(removeChatTagRef, { key: TEST_KEY, chatGuid: GUID, tag: "nope" }),
    ).resolves.toBeNull();
  });

  test("chat tags and person tags are independent namespaces", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(addTagRef, { key: TEST_KEY, personId, tag: "vip" });
    await t.mutation(addChatTagRef, { key: TEST_KEY, chatGuid: GUID, tag: "vip" });
    const personRows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    const chatRows = await t.run((ctx) =>
      ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", GUID)).collect(),
    );
    expect(personRows).toHaveLength(1);
    expect(chatRows).toHaveLength(1);
  });
});
