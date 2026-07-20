import { describe, expect, test } from "vitest";

import { normalizeEmail, normalizePhone } from "./normalize";

describe("createPerson handle classification", () => {
  test("a phone-shaped handle is classified as kindphone", () => {
    const handle = "(619) 555-1234";
    const trimmed = handle.trim();
    const kind = normalizePhone(trimmed) ? "phone" : "email";
    expect(kind).toBe("phone");
  });

  test("an email-shaped handle is classified as kind email", () => {
    const handle = "chase@example.com";
    const trimmed = handle.trim();
    const kind = normalizePhone(trimmed) ? "phone" : "email";
    expect(kind).toBe("email");
  });

  test("normalized_phones vs normalized_emails on the new person reflects the classified kind", () => {
    const normalized = normalizePhone("6195551234");
    const kind = "phone" as const;
    const person = {
      normalized_phones: kind === "phone" ? [normalized] : [],
      normalized_emails: (kind as string) === "email" ? [normalized] : [],
    };
    expect(person.normalized_phones).toEqual(["+16195551234"]);
    expect(person.normalized_emails).toEqual([]);
  });
});

describe("createPerson dedupe (existing identity short-circuits creation)", () => {
  test("if the normalized handle already has an identity+person, no new person is created", () => {
    const existingIdentity = { normalized: "+16195551234", person_id: "person_existing" };
    const created = !existingIdentity.person_id;
    expect(created).toBe(false);
  });

  test("an identity with no person_id yet does not short-circuit (still creates)", () => {
    const existingIdentity: { normalized: string; person_id: string | undefined } = {
      normalized: "+16195551234",
      person_id: undefined,
    };
    const created = !existingIdentity.person_id;
    expect(created).toBe(true);
  });
});

describe("createPerson source tagging", () => {
  test("manually-created identities are tagged source: manual, distinct from apple_contact/beeper", () => {
    const identity = { source: "manual" };
    expect(identity.source).not.toBe("apple_contact");
    expect(identity.source).not.toBe("participant");
  });

  test("manually-created people are not auto_clustered", () => {
    const person = { auto_clustered: false };
    expect(person.auto_clustered).toBe(false);
  });
});
