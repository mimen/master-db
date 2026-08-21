import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import {
  chatCrmRef,
  linkEventRef,
  listPeopleRef,
  listTagsRef,
  nameDirectoryRef,
  searchPeopleRef,
  setChatFavoriteRef,
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
    priority: number;
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
    ctx.db.insert("tags", { person_id: personId, tag, created_at: new Date().toISOString() }),
  );
}

async function seedChatTag(t: TestConvex<typeof schema>, chatGuid: string, tag: string): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert("tags", { chat_guid: chatGuid, tag, created_at: new Date().toISOString() }),
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
    const personId = await seedPerson(t, { display_name: "Chase", is_favorite: true, priority: 1 });
    await seedIdentity(t, personId, { source: "apple_contact" });
    await seedTag(t, personId, "vip");
    await seedTag(t, personId, "family");

    const result = (await t.query(whoIsRef, { key: TEST_KEY, handle: "6195551234" })) as {
      found: boolean;
      person?: { is_favorite?: boolean; priority?: number };
      tags?: string[];
      events?: unknown[];
    };
    expect(result.found).toBe(true);
    expect(result.person?.is_favorite).toBe(true);
    expect(result.person?.priority).toBe(1);
    expect(result.tags).toEqual(["family", "vip"]);
    expect(result.events).toEqual([]);
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

  test("includes linked events", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase" });
    await seedIdentity(t, personId, { source: "apple_contact" });
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });

    const result = (await t.query(whoIsRef, { key: TEST_KEY, handle: "6195551234" })) as {
      events?: Array<{ id: string; name: string }>;
    };
    expect(result.events).toEqual([{ id: "evt1", name: "Summer Bash", linkId: expect.any(String) }]);
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

  test("projects is_favorite, priority, tags, and events per person", async () => {
    const t = convexTest(schema, modules);
    const alex = await seedPerson(t, { display_name: "Alex", is_favorite: true });
    const chase = await seedPerson(t, { display_name: "Chase", priority: 4 });
    await seedTag(t, alex, "vip");
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId: chase,
      airtable_event_id: "evt1",
      event_name: "Fall Kickoff",
    });

    const results = (await t.query(listPeopleRef, { key: TEST_KEY })) as Array<{
      display_name?: string;
      is_favorite?: boolean;
      priority?: number;
      tags: string[];
      events: Array<{ id: string; name: string; linkId: string }>;
    }>;
    const alexRow = results.find((r) => r.display_name === "Alex");
    const chaseRow = results.find((r) => r.display_name === "Chase");
    expect(alexRow?.is_favorite).toBe(true);
    expect(alexRow?.tags).toEqual(["vip"]);
    expect(alexRow?.events).toEqual([]);
    expect(chaseRow?.priority).toBe(4);
    expect(chaseRow?.tags).toEqual([]);
    expect(chaseRow?.events).toEqual([{ id: "evt1", name: "Fall Kickoff", linkId: expect.any(String) }]);
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

  test("counts a tag across BOTH people and chats in one unified total", async () => {
    const t = convexTest(schema, modules);
    const a = await seedPerson(t, { display_name: "A" });
    await seedTag(t, a, "vip");
    await seedChatTag(t, "iMessage;+;chat1", "vip");
    await seedChatTag(t, "iMessage;+;chat2", "vip");

    const results = await t.query(listTagsRef, { key: TEST_KEY });
    expect(results).toEqual([{ tag: "vip", count: 3 }]);
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
    expect(results).toEqual([
      { normalized: "+16195551111", display_name: "Milad", terms: ["milad"], crm: { tags: [], events: [] } },
    ]);
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
    expect(results).toEqual([
      { normalized: "+16195552222", display_name: "SoloName", terms: ["soloname"], crm: { tags: [], events: [] } },
    ]);
  });

  test("carries the person's CRM (favorite/priority/tags/events) alongside every handle entry", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, {
      display_name: "Chase",
      is_favorite: true,
      priority: 2,
      normalized_phones: ["+16195551234", "+16195555678"],
    });
    await seedTag(t, personId, "vip");
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Launch Party",
    });

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toHaveLength(2);
    for (const entry of results) {
      expect(entry.crm).toEqual({
        is_favorite: true,
        priority: 2,
        tags: ["vip"],
        events: [{ id: "evt1", name: "Launch Party", linkId: expect.any(String) }],
      });
    }
  });

  test("omits a still-string (un-migrated) priority from crm rather than leaking it", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Legacy",
        priority: "high",
        normalized_phones: ["+16195553333"],
        normalized_emails: [],
        identity_count: 0,
        message_count: 0,
        is_self: false,
        auto_clustered: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    );

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    expect(results).toHaveLength(1);
    expect(results[0]?.crm.priority).toBeUndefined();
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(nameDirectoryRef, { key: "wrong" })).rejects.toThrow();
  });

  test("carries each person's tags and event links through the flattened crm", async () => {
    const t = convexTest(schema, modules);
    const alex = await seedPerson(t, {
      display_name: "Alex",
      normalized_phones: ["+16195551111"],
    });
    const chase = await seedPerson(t, {
      display_name: "Chase",
      normalized_emails: ["chase@example.com"],
    });
    await seedTag(t, alex, "vip");
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId: chase,
      airtable_event_id: "evt1",
      event_name: "Fall Kickoff",
    });

    const results = await t.query(nameDirectoryRef, { key: TEST_KEY });
    const alexRow = results.find((r) => r.normalized === "+16195551111");
    const chaseRow = results.find((r) => r.normalized === "chase@example.com");
    expect(alexRow?.crm.tags).toEqual(["vip"]);
    expect(alexRow?.crm.events).toEqual([]);
    expect(chaseRow?.crm.events).toEqual([
      { id: "evt1", name: "Fall Kickoff", linkId: expect.any(String) },
    ]);
    expect(chaseRow?.crm.tags).toEqual([]);
  });

  test("stays flat when many people exist — the whole-table read count must not grow with the people table", async () => {
    // Regression for the live incident: listPeople/nameDirectory looped a
    // per-person indexed lookup over every person (N+1), which pushed Convex
    // past its per-query operation budget ("too many system operations") and
    // timed out once the directory grew. The fix reads tags and event_links
    // exactly once regardless of people count; this pins that with more
    // seeded people than any N+1 budget would tolerate in CI.
    const t = convexTest(schema, modules);
    for (let i = 0; i < 60; i++) {
      await seedPerson(t, { display_name: `P${String(i).padStart(2, "0")}` });
    }
    const first = await t.run(async (ctx) =>
      ctx.db.query("people").order("desc").take(1),
    );
    const someone = first[0]!;
    await seedTag(t, someone._id, "vip");
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId: someone._id,
      airtable_event_id: "evt9",
      event_name: "Late Link",
    });

    const results = (await t.query(listPeopleRef, { key: TEST_KEY })) as Array<{
      display_name?: string;
      tags: string[];
      events: Array<{ id: string; name: string; linkId: string }>;
    }>;
    expect(results).toHaveLength(60);
    const tagged = results.find((r) => r.display_name === someone.display_name);
    expect(tagged?.tags).toEqual(["vip"]);
    expect(tagged?.events).toEqual([
      { id: "evt9", name: "Late Link", linkId: expect.any(String) },
    ]);
    // And the mirror projection agrees.
    const dir = (await t.query(nameDirectoryRef, { key: TEST_KEY })) as Array<{
      crm: { tags: string[] };
    }>;
    expect(dir.every((r) => r.crm.tags.length <= 1)).toBe(true);
  });
});

describe("chatCrm", () => {
  test("projects favorite/priority/tags/events for a batch of chat guids", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: "g1", is_favorite: true });
    await seedChatTag(t, "g1", "planning");
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      chatGuid: "g1",
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });

    const results = await t.query(chatCrmRef, { key: TEST_KEY, chatGuids: ["g1", "g2"] });
    expect(results.g1).toEqual({
      is_favorite: true,
      tags: ["planning"],
      events: [{ id: "evt1", name: "Summer Bash", linkId: expect.any(String) }],
    });
    expect(results.g2).toBeUndefined();
  });

  test("a chat with only a tag (no chat_crm row) still projects", async () => {
    const t = convexTest(schema, modules);
    await seedChatTag(t, "g1", "planning");

    const results = await t.query(chatCrmRef, { key: TEST_KEY, chatGuids: ["g1"] });
    expect(results.g1).toEqual({ tags: ["planning"], events: [] });
  });

  test("omitting chatGuids returns every chat with any CRM data", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(setChatFavoriteRef, { key: TEST_KEY, chatGuid: "g1", is_favorite: true });
    await seedChatTag(t, "g2", "vip");

    const results = await t.query(chatCrmRef, { key: TEST_KEY });
    expect(Object.keys(results).sort()).toEqual(["g1", "g2"]);
  });

  test("never includes a person's tags/events under a chat guid", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t, { display_name: "Chase" });
    await seedTag(t, personId, "vip");

    const results = await t.query(chatCrmRef, { key: TEST_KEY });
    expect(results).toEqual({});
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(chatCrmRef, { key: "wrong" })).rejects.toThrow();
  });
});
