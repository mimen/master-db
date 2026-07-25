import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { linkEventRef, TEST_KEY, unlinkEventRef } from "./testRefs.vitest";

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

describe("linkEvent", () => {
  test("links a person to an event", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    const result = await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });
    const link = await t.run((ctx) => ctx.db.get(result.linkId));
    expect(link?.person_id).toBe(personId);
    expect(link?.chat_guid).toBeUndefined();
    expect(link?.airtable_event_id).toBe("evt1");
    expect(link?.event_name).toBe("Summer Bash");
  });

  test("links a GROUP chat to an event", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(linkEventRef, {
      key: TEST_KEY,
      chatGuid: "iMessage;+;chat123",
      airtable_event_id: "evt2",
      event_name: "Fall Kickoff",
    });
    const link = await t.run((ctx) => ctx.db.get(result.linkId));
    expect(link?.chat_guid).toBe("iMessage;+;chat123");
    expect(link?.person_id).toBeUndefined();
  });

  test("rejects when both personId and chatGuid are given", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await expect(
      t.mutation(linkEventRef, {
        key: TEST_KEY,
        personId,
        chatGuid: "g1",
        airtable_event_id: "evt1",
        event_name: "X",
      }),
    ).rejects.toThrow("exactly one");
  });

  test("rejects when neither personId nor chatGuid is given", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(linkEventRef, { key: TEST_KEY, airtable_event_id: "evt1", event_name: "X" }),
    ).rejects.toThrow("exactly one");
  });

  test("dedupes: linking the same event to the same owner twice returns the same link", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    const first = await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });
    const second = await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });
    expect(second.linkId).toBe(first.linkId);
    const rows = await t.run((ctx) =>
      ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(rows).toHaveLength(1);
  });

  test("re-linking with a changed event_name refreshes the cached label", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });
    await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash (renamed)",
    });
    const rows = await t.run((ctx) =>
      ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_name).toBe("Summer Bash (renamed)");
  });

  test("a person can link to multiple distinct events", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(linkEventRef, { key: TEST_KEY, personId, airtable_event_id: "evt1", event_name: "A" });
    await t.mutation(linkEventRef, { key: TEST_KEY, personId, airtable_event_id: "evt2", event_name: "B" });
    const rows = await t.run((ctx) =>
      ctx.db.query("event_links").withIndex("by_person", (q) => q.eq("person_id", personId)).collect(),
    );
    expect(rows).toHaveLength(2);
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await expect(
      t.mutation(linkEventRef, { key: "wrong", personId, airtable_event_id: "evt1", event_name: "X" }),
    ).rejects.toThrow();
  });
});

describe("unlinkEvent", () => {
  test("removes the link", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    const { linkId } = await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });
    await t.mutation(unlinkEventRef, { key: TEST_KEY, linkId });
    expect(await t.run((ctx) => ctx.db.get(linkId))).toBeNull();
  });

  test("no-ops cleanly when the link is already gone", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    const { linkId } = await t.mutation(linkEventRef, {
      key: TEST_KEY,
      personId,
      airtable_event_id: "evt1",
      event_name: "Summer Bash",
    });
    await t.mutation(unlinkEventRef, { key: TEST_KEY, linkId });
    await expect(t.mutation(unlinkEventRef, { key: TEST_KEY, linkId })).resolves.toBeNull();
  });
});
