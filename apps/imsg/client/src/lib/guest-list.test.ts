import { describe, expect, test } from "bun:test";

import type { GuestListEvent } from "@/lib/identity";

import { guestContact, guestRowState, isCompleteContact, withGuest } from "./guest-list";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const event: GuestListEvent = {
  eventId: "recEvt",
  name: "Freakuency 2026",
  startDate: "2026-11-01T03:00:00.000Z",
  deadline: "2026-11-01T00:00:00.000Z",
  guestEmails: ["chase@example.test"],
};

describe("guestRowState", () => {
  test("a person whose email is already on the list reads as listed, whatever its case", () => {
    expect(guestRowState(event, ["Chase@Example.test"], NOW)).toBe("on-list");
  });

  test("anyone else can be added until the comp deadline, with no cap", () => {
    expect(guestRowState(event, ["new@example.test"], NOW)).toBe("open");
    expect(guestRowState({ ...event, deadline: null }, [], NOW)).toBe("open");
    expect(guestRowState(event, [], Date.parse("2026-11-01T01:00:00Z"))).toBe("closed");
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

test("withGuest lists the email, normalized", () => {
  expect(withGuest(event, " New@Example.test ").guestEmails).toEqual(["chase@example.test", "new@example.test"]);
});
