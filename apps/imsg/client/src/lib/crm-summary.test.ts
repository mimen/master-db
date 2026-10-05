import { describe, expect, test } from "bun:test";

import { crmSummary } from "./crm-summary";

describe("crmSummary", () => {
  test("lists only what is set, singular and plural", () => {
    expect(crmSummary({ isFavorite: true, priority: 1, tagCount: 2, eventCount: 1 })).toBe("Favorite · P1 · 2 tags · 1 event");
    expect(crmSummary({ isFavorite: false, priority: undefined, tagCount: 1, eventCount: 0 })).toBe("1 tag");
  });

  test("an empty record says so", () => {
    expect(crmSummary({ isFavorite: false, priority: undefined, tagCount: 0, eventCount: 0 })).toBe("Not set");
  });
});

import { editedLine, eventTile, priorityFromOption, priorityOption } from "./crm-summary";

describe("priority dropdown", () => {
  test("round-trips every level and unset", () => {
    for (const p of [1, 2, 3, 4, 5]) expect(priorityFromOption(priorityOption(p))).toBe(p);
    expect(priorityOption(undefined)).toBe("none");
    expect(priorityFromOption("none")).toBeNull();
  });
});

describe("eventTile", () => {
  test("reads a timed event in local time", () => {
    const tile = eventTile(new Date(2026, 9, 10, 19, 0).toISOString());
    expect(tile).toEqual({ day: "10", month: "Oct", time: "7:00 PM", long: "Sat, Oct 10, 7:00 PM" });
  });

  test("a date-only event has no time, and no date gives no tile", () => {
    expect(eventTile("2026-10-24")).toEqual({ day: "24", month: "Oct", time: "", long: "Sat, Oct 24" });
    expect(eventTile(undefined)).toBeNull();
  });
});

describe("editedLine", () => {
  test("formats the notes stamp", () => {
    expect(editedLine(new Date(2026, 8, 30, 12).toISOString())).toBe("Edited Sep 30");
    expect(editedLine(undefined)).toBe("");
  });
});
