import { describe, expect, test } from "bun:test";

import type { GuestListEvent } from "@/lib/identity";

import { guestContact, guestRowState, isCompleteContact, withGuest } from "./guest-list";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const ga = { tierId: "recGA", tierName: "General Admission", remaining: 2 };
const event: GuestListEvent = {
  eventId: "recEvt",
  name: "Freakuency 2026",
  startDate: "2026-11-01T03:00:00.000Z",
  deadline: "2026-11-01T00:00:00.000Z",
  tiers: [{ ...ga, tierId: "recAA", remaining: 0 }, ga],
  guestEmails: ["chase@example.test"],
};

describe("guestRowState", () => {
  test("a person whose email is already on the list reads as listed, whatever its case", () => {
    expect(guestRowState(event, ["Chase@Example.test"], NOW)).toEqual({ kind: "on-list" });
  });

  test("an open event offers the first tier that still has room", () => {
    expect(guestRowState(event, ["new@example.test"], NOW)).toEqual({ kind: "open", tier: ga });
  });

  test("past the comp deadline it is closed, and with no room it is full", () => {
    expect(guestRowState(event, [], Date.parse("2026-11-01T01:00:00Z"))).toEqual({ kind: "closed" });
    expect(guestRowState({ ...event, tiers: [{ ...ga, remaining: 0 }] }, [], NOW)).toEqual({ kind: "full" });
  });
});

describe("guestContact", () => {
  test("prefers structured names and falls back to splitting the display name", () => {
    expect(guestContact({ first_name: "Chase", last_name: "Petersen", display_name: "C P", normalized_emails: ["c@x.co"] }))
      .toEqual({ firstName: "Chase", lastName: "Petersen", email: "c@x.co" });
    expect(guestContact({ display_name: "Mary Jane Watson", normalized_emails: [] }))
      .toEqual({ firstName: "Mary", lastName: "Jane Watson", email: "" });
  });

  test("a contact missing an email or last name is not complete", () => {
    expect(isCompleteContact({ firstName: "Mary", lastName: "Watson", email: "m@x.co" })).toBe(true);
    expect(isCompleteContact({ firstName: "Mary", lastName: "Watson", email: "" })).toBe(false);
    expect(isCompleteContact({ firstName: "Mary", lastName: " ", email: "m@x.co" })).toBe(false);
  });
});

test("withGuest lists the email and spends one spot on its tier only", () => {
  const next = withGuest(event, "recGA", " New@Example.test ");
  expect(next.guestEmails).toEqual(["chase@example.test", "new@example.test"]);
  expect(next.tiers.map((t) => t.remaining)).toEqual([0, 1]);
});
