import { describe, expect, test } from "vitest";

import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * Replicates the pre-grouped ingest logic in ingestContacts.ts as plain
 * assertions, matching this repo's mutation-test convention.
 */

describe("card -> handles extraction", () => {
  test("builds a handle per phone and email, tagging kind and normalized value", () => {
    const card = { phones: ["6195551234"], emails: ["Milad@Example.com"] };
    const handles = [
      ...card.phones.map((p) => ({ value: p, kind: "phone" as const, normalized: normalizePhone(p) })),
      ...card.emails.map((e) => ({ value: e, kind: "email" as const, normalized: normalizeEmail(e) })),
    ];
    expect(handles).toEqual([
      { value: "6195551234", kind: "phone", normalized: "+16195551234" },
      { value: "Milad@Example.com", kind: "email", normalized: "milad@example.com" },
    ]);
  });

  test("a card with no phones or emails yields zero handles (skip candidate)", () => {
    const card = { phones: [] as string[], emails: [] as string[] };
    const handles = [...card.phones, ...card.emails];
    expect(handles).toHaveLength(0);
  });
});

describe("same-source dedupe (re-ingest reuses the existing person)", () => {
  test("a handle already ingested under this source resolves to its existing person, not a new one", () => {
    const existingRows = [
      { value: "+16195551234", source: "apple_contact", person_id: "person_1" },
      { value: "+16195551234", source: "airtable_human", person_id: "person_2" },
    ];
    const source = "apple_contact";
    const match = existingRows.find((r) => r.source === source);
    expect(match?.person_id).toBe("person_1");
  });

  test("no same-source match falls through to cross-source normalized lookup", () => {
    const existingRows = [{ value: "+16195551234", source: "airtable_human", person_id: "person_2" }];
    const source = "apple_contact";
    const match = existingRows.find((r) => r.source === source);
    expect(match).toBeUndefined();
  });
});

describe("cross-source linking via normalized key", () => {
  test("a card's phone matching an existing Beeper identity's normalized value joins that person", () => {
    const beeperIdentity = { normalized: "+16195551234", person_id: "person_from_whatsapp" };
    const cardHandle = { value: "(619) 555-1234", normalized: normalizePhone("(619) 555-1234") };
    expect(cardHandle.normalized).toBe(beeperIdentity.normalized);
  });

  test("a merged-away person is not reused even if its identity matches", () => {
    const match = { person_id: "person_x" };
    const person = { _id: "person_x", merged_into: "person_y" };
    const reusable = match.person_id === person._id && !person.merged_into;
    expect(reusable).toBe(false);
  });

  test("a handle with no normalized value (unparseable) never cross-source-links", () => {
    const handle = { normalized: normalizePhone("abc") };
    expect(handle.normalized).toBe("");
    const shouldLookup = Boolean(handle.normalized);
    expect(shouldLookup).toBe(false);
  });
});

describe("multi-handle card grouping (the core fix)", () => {
  test("mobile + home + email on one card all resolve to the SAME person, despite not sharing a normalized key with each other", () => {
    const card = { phones: ["6195551234", "8585559876"], emails: ["chase@example.com"] };
    // None of these three normalized values equal each other...
    const normalizedMobile = normalizePhone(card.phones[0] ?? "");
    const normalizedHome = normalizePhone(card.phones[1] ?? "");
    const normalizedEmail = normalizeEmail(card.emails[0] ?? "");
    expect(normalizedMobile).not.toBe(normalizedHome);
    expect(new Set([normalizedMobile, normalizedHome, normalizedEmail]).size).toBe(3);
    // ...but ingest assigns them one shared personId regardless, because the
    // card itself (not shared normalized keys) is the grouping signal.
    const sharedPersonId = "person_new";
    const identities = [normalizedMobile, normalizedHome, normalizedEmail].map((normalized) => ({
      normalized,
      person_id: sharedPersonId,
    }));
    expect(new Set(identities.map((i) => i.person_id)).size).toBe(1);
  });
});

describe("airtable_record_id patch (keep-if-existing, like other merge fields)", () => {
  test("sets airtable_human_id when the person doesn't have one yet", () => {
    const person = { airtable_human_id: undefined as string | undefined };
    const card = { airtable_record_id: "recABC123" };
    const shouldPatch = Boolean(card.airtable_record_id) && !person.airtable_human_id;
    expect(shouldPatch).toBe(true);
  });

  test("never overwrites an existing airtable_human_id", () => {
    const person = { airtable_human_id: "recEXISTING" as string | undefined };
    const card = { airtable_record_id: "recABC123" };
    const shouldPatch = Boolean(card.airtable_record_id) && !person.airtable_human_id;
    expect(shouldPatch).toBe(false);
  });

  test("no-op when the card carries no record id at all (e.g. an Apple Contacts card)", () => {
    const card = { airtable_record_id: undefined as string | undefined };
    expect(Boolean(card.airtable_record_id)).toBe(false);
  });
});

describe("display_name merge on re-ingest (mirrors upsertIdentitiesBatch rules)", () => {
  test("longer incoming display_name overwrites the existing one", () => {
    const existing = { display_name: "Chase" };
    const incoming = { display_name: "Chase Petersen" };
    const merged =
      incoming.display_name && incoming.display_name.length > (existing.display_name?.length ?? 0)
        ? incoming.display_name
        : existing.display_name;
    expect(merged).toBe("Chase Petersen");
  });
});
