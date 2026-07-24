import { convexTest, type TestConvex } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { addPersonFromAirtableRef, createPersonRef, renamePersonRef, TEST_KEY } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

beforeEach(() => {
  process.env.IMSG_IDENTITY_KEY = TEST_KEY;
});

describe("createPerson", () => {
  test("fresh handle with no name creates an unlocked person with one manual identity", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(createPersonRef, { key: TEST_KEY, handle: "(619) 555-1234" });
    expect(result.created).toBe(true);

    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.display_name).toBeUndefined();
    expect(person?.display_name_locked).toBeFalsy();
    expect(person?.normalized_phones).toEqual(["+16195551234"]);
    expect(person?.identity_count).toBe(1);

    const identities = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_person", (q) => q.eq("person_id", result.personId))
        .collect(),
    );
    expect(identities).toHaveLength(1);
    expect(identities[0]?.source).toBe("manual");
    expect(identities[0]?.kind).toBe("phone");
  });

  test("fresh handle with a name locks display_name on the new person", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(createPersonRef, {
      key: TEST_KEY,
      handle: "chase@example.com",
      display_name: "Chase",
    });
    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.display_name).toBe("Chase");
    expect(person?.display_name_locked).toBe(true);
    expect(person?.normalized_emails).toEqual(["chase@example.com"]);
  });

  test("dedupe path: an already-resolved identity short-circuits creation and applies the typed name", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    const personId = await t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Old Name",
        normalized_phones: ["+16195551234"],
        normalized_emails: [],
        identity_count: 1,
        message_count: 0,
        is_self: false,
        auto_clustered: true,
        created_at: now,
        updated_at: now,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("identities", {
        person_id: personId,
        kind: "phone",
        value: "+16195551234",
        normalized: "+16195551234",
        network: undefined,
        display_name: "Old Name",
        message_count: 0,
        chat_count: 0,
        is_self: false,
        source: "apple_contact",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      }),
    );

    const result = await t.mutation(createPersonRef, {
      key: TEST_KEY,
      handle: "6195551234",
      display_name: "New Typed Name",
    });
    expect(result.created).toBe(false);
    expect(result.personId).toBe(personId);

    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("New Typed Name");
    expect(person?.display_name_locked).toBe(true);

    // Dedupe must not create a second person.
    const allPeople = await t.run((ctx) => ctx.db.query("people").collect());
    expect(allPeople).toHaveLength(1);
  });

  test("dedupe path: no name provided leaves the existing person's name untouched", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    const personId = await t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Existing Name",
        normalized_phones: ["+16195551234"],
        normalized_emails: [],
        identity_count: 1,
        message_count: 0,
        is_self: false,
        auto_clustered: true,
        created_at: now,
        updated_at: now,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("identities", {
        person_id: personId,
        kind: "phone",
        value: "+16195551234",
        normalized: "+16195551234",
        network: undefined,
        message_count: 0,
        chat_count: 0,
        is_self: false,
        source: "apple_contact",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      }),
    );

    const result = await t.mutation(createPersonRef, { key: TEST_KEY, handle: "6195551234" });
    expect(result.created).toBe(false);
    expect(result.personId).toBe(personId);
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Existing Name");
  });

  test("orphan-identity-rows path: unresolved rows sharing the normalized key are linked to the new person", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    // An identity ingested by the Beeper resolver path but never clustered
    // (person_id undefined) — e.g. a chat participant seen before any
    // person existed for them.
    await t.run((ctx) =>
      ctx.db.insert("identities", {
        person_id: undefined,
        kind: "phone",
        value: "+16195551234",
        normalized: "+16195551234",
        network: "imessage",
        display_name: "From Chat",
        message_count: 3,
        chat_count: 1,
        is_self: false,
        source: "participant",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      }),
    );

    const result = await t.mutation(createPersonRef, { key: TEST_KEY, handle: "6195551234" });
    expect(result.created).toBe(true);

    const orphan = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_normalized", (q) => q.eq("normalized", "+16195551234"))
        .collect(),
    );
    // The orphan row is now linked, and a new manual-source row was added
    // (no manual row existed for this value yet).
    expect(orphan.every((r) => r.person_id === result.personId)).toBe(true);
    expect(orphan.some((r) => r.source === "participant")) .toBe(true);
    expect(orphan.some((r) => r.source === "manual")).toBe(true);

    const person = await t.run((ctx) => ctx.db.get(result.personId));
    // No name provided -> recompute derives the best name from linked identities.
    expect(person?.display_name).toBe("From Chat");
    expect(person?.identity_count).toBe(2);
  });

  test("orphan-identity-rows path: does not insert a duplicate manual row if one already exists", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    await t.run((ctx) =>
      ctx.db.insert("identities", {
        person_id: undefined,
        kind: "phone",
        value: "6195551234",
        normalized: "+16195551234",
        network: undefined,
        message_count: 0,
        chat_count: 0,
        is_self: false,
        source: "manual",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      }),
    );

    const result = await t.mutation(createPersonRef, { key: TEST_KEY, handle: "6195551234" });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_normalized", (q) => q.eq("normalized", "+16195551234"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.person_id).toBe(result.personId);
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(createPersonRef, { key: "wrong", handle: "6195551234" }),
    ).rejects.toThrow();
  });

  test("first_name/last_name with no display_name override derives 'First Last', sets parts, locks", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(createPersonRef, {
      key: TEST_KEY,
      handle: "6195551234",
      first_name: "Chase",
      last_name: "Petersen",
    });
    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.display_name).toBe("Chase Petersen");
    expect(person?.first_name).toBe("Chase");
    expect(person?.last_name).toBe("Petersen");
    expect(person?.display_name_locked).toBe(true);
  });

  test("an explicit display_name override wins over the derived 'First Last'", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(createPersonRef, {
      key: TEST_KEY,
      handle: "6195551234",
      first_name: "Chase",
      last_name: "Petersen",
      display_name: "Chasey P",
    });
    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.display_name).toBe("Chasey P");
    expect(person?.first_name).toBe("Chase");
    expect(person?.last_name).toBe("Petersen");
  });

  test("nickname and organization are set on a freshly-created person", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(createPersonRef, {
      key: TEST_KEY,
      handle: "6195551234",
      first_name: "Chase",
      nickname: "Chasey",
      organization: "Afternoon Umbrella Friends",
    });
    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.nickname).toBe("Chasey");
    expect(person?.organization).toBe("Afternoon Umbrella Friends");
  });

  test("dedupe path: only the fields actually passed are touched — first_name alone doesn't clear an existing nickname", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    const personId = await t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Existing Name",
        nickname: "Existing Nick",
        normalized_phones: ["+16195551234"],
        normalized_emails: [],
        identity_count: 1,
        message_count: 0,
        is_self: false,
        auto_clustered: true,
        created_at: now,
        updated_at: now,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("identities", {
        person_id: personId,
        kind: "phone",
        value: "+16195551234",
        normalized: "+16195551234",
        network: undefined,
        message_count: 0,
        chat_count: 0,
        is_self: false,
        source: "apple_contact",
        first_seen_at: now,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      }),
    );

    const result = await t.mutation(createPersonRef, {
      key: TEST_KEY,
      handle: "6195551234",
      first_name: "Chase",
    });
    expect(result.created).toBe(false);
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.first_name).toBe("Chase");
    expect(person?.nickname).toBe("Existing Nick");
  });
});

describe("addPersonFromAirtable", () => {
  test("creates a person from an Airtable record with a phone", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(addPersonFromAirtableRef, {
      key: TEST_KEY,
      record_id: "recABC123",
      display_name: "Jamie",
      phone: "6195559999",
    });
    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.display_name).toBe("Jamie");
    expect(person?.airtable_human_id).toBe("recABC123");
  });

  test("throws when the record has neither phone nor email", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(addPersonFromAirtableRef, { key: TEST_KEY, record_id: "recNoHandles", display_name: "Nobody" }),
    ).rejects.toThrow("Can't add a contact with no phone or email");
  });

  test("threads first_name/last_name onto the created person", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(addPersonFromAirtableRef, {
      key: TEST_KEY,
      record_id: "recStructured",
      display_name: "Jamie Rivera",
      first_name: "Jamie",
      last_name: "Rivera",
      phone: "6195551212",
    });
    const person = await t.run((ctx) => ctx.db.get(result.personId));
    expect(person?.first_name).toBe("Jamie");
    expect(person?.last_name).toBe("Rivera");
    expect(person?.airtable_human_id).toBe("recStructured");
  });
});

describe("renamePerson", () => {
  async function seedPerson(t: TestConvex<typeof schema>): Promise<Id<"people">> {
    const now = new Date().toISOString();
    return t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Original",
        normalized_phones: [],
        normalized_emails: [],
        identity_count: 0,
        message_count: 0,
        is_self: false,
        auto_clustered: false,
        created_at: now,
        updated_at: now,
      }),
    );
  }

  test("rejects an empty/whitespace-only name", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await expect(
      t.mutation(renamePersonRef, { key: TEST_KEY, personId, display_name: "   " }),
    ).rejects.toThrow("Name can't be empty");
  });

  test("trims surrounding whitespace and sets the lock", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(renamePersonRef, { key: TEST_KEY, personId, display_name: "  Chase Anderson  " });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Chase Anderson");
    expect(person?.display_name_locked).toBe(true);
  });

  test("omitting display_name derives it from first_name + last_name, sets parts, locks", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(renamePersonRef, { key: TEST_KEY, personId, first_name: "Chase", last_name: "Petersen" });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Chase Petersen");
    expect(person?.first_name).toBe("Chase");
    expect(person?.last_name).toBe("Petersen");
    expect(person?.display_name_locked).toBe(true);
  });

  test("omitting display_name AND first/last keeps the person's current display_name", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t); // display_name: "Original"
    await t.mutation(renamePersonRef, { key: TEST_KEY, personId, organization: "AUF" });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Original");
    expect(person?.organization).toBe("AUF");
  });

  test("an explicit display_name override wins over first/last when both are provided", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.mutation(renamePersonRef, {
      key: TEST_KEY,
      personId,
      display_name: "Chasey P",
      first_name: "Chase",
      last_name: "Petersen",
    });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.display_name).toBe("Chasey P");
    expect(person?.first_name).toBe("Chase");
  });

  test("partial update: setting nickname alone doesn't touch first_name/last_name/organization already on the person", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    const personId = await t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Chase Petersen",
        first_name: "Chase",
        last_name: "Petersen",
        organization: "AUF",
        normalized_phones: [],
        normalized_emails: [],
        identity_count: 0,
        message_count: 0,
        is_self: false,
        auto_clustered: false,
        created_at: now,
        updated_at: now,
      }),
    );
    await t.mutation(renamePersonRef, { key: TEST_KEY, personId, nickname: "Chasey" });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.nickname).toBe("Chasey");
    expect(person?.first_name).toBe("Chase");
    expect(person?.last_name).toBe("Petersen");
    expect(person?.organization).toBe("AUF");
  });

  test("passing an empty string for nickname clears it (distinct from omitting the key)", async () => {
    const t = convexTest(schema, modules);
    const now = new Date().toISOString();
    const personId = await t.run((ctx) =>
      ctx.db.insert("people", {
        display_name: "Chase",
        nickname: "Chasey",
        normalized_phones: [],
        normalized_emails: [],
        identity_count: 0,
        message_count: 0,
        is_self: false,
        auto_clustered: false,
        created_at: now,
        updated_at: now,
      }),
    );
    await t.mutation(renamePersonRef, { key: TEST_KEY, personId, nickname: "" });
    const person = await t.run((ctx) => ctx.db.get(personId));
    expect(person?.nickname).toBeUndefined();
  });

  test("rejects a wrong key", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await expect(
      t.mutation(renamePersonRef, { key: "wrong", personId, display_name: "X" }),
    ).rejects.toThrow();
  });

  test("throws when the person doesn't exist", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await t.run((ctx) => ctx.db.delete(personId));
    await expect(
      t.mutation(renamePersonRef, { key: TEST_KEY, personId, display_name: "X" }),
    ).rejects.toThrow("Person not found");
  });
});
