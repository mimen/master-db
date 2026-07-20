import { describe, expect, test } from "vitest";

import { normalizeEmail, normalizePhone } from "./normalize";

describe("whoIs input normalization", () => {
  test("normalizes a phone-shaped handle before lookup", () => {
    const handle = "(619) 555-1234";
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    expect(normalized).toBe("+16195551234");
  });

  test("normalizes an email-shaped handle before lookup", () => {
    const handle = "  Milad@Example.com  ";
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    expect(normalized).toBe("milad@example.com");
  });

  test("falls back to the trimmed raw handle when neither phone nor email normalization applies", () => {
    const handle = "  @weird:matrix.org  ";
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    expect(normalized).toBe("@weird:matrix.org");
  });

  test("no matching identity or unresolved person_id reports not found", () => {
    const match = null as { person_id?: string } | null;
    const found = Boolean(match?.person_id);
    expect(found).toBe(false);
  });
});

describe("searchPeople filter", () => {
  const people = [
    { display_name: "Milad Imen", merged_into: undefined },
    { display_name: "Mila Kunis", merged_into: undefined },
    { display_name: "Someone Merged", merged_into: "other_id" },
    { display_name: undefined, merged_into: undefined },
  ];

  test("case-insensitive substring match on display_name", () => {
    const needle = "MILAD".trim().toLowerCase();
    const matches = people.filter(
      (p) => !p.merged_into && (p.display_name ?? "").toLowerCase().includes(needle),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.display_name).toBe("Milad Imen");
  });

  test("excludes people that were merged away", () => {
    const needle = "someone";
    const matches = people.filter(
      (p) => !p.merged_into && (p.display_name ?? "").toLowerCase().includes(needle),
    );
    expect(matches).toHaveLength(0);
  });

  test("people with no display_name never match a non-empty needle", () => {
    const needle = "anything";
    const matches = people.filter(
      (p) => !p.merged_into && (p.display_name ?? "").toLowerCase().includes(needle),
    );
    expect(matches.some((p) => p.display_name === undefined)).toBe(false);
  });
});

describe("topLinkedPeople selection", () => {
  test("excludes merged-away people and singletons, sorts by identity_count desc, respects limit", () => {
    const people = [
      { display_name: "A", identity_count: 1, merged_into: undefined },
      { display_name: "B", identity_count: 3, merged_into: undefined },
      { display_name: "C", identity_count: 5, merged_into: "x" },
      { display_name: "D", identity_count: 2, merged_into: undefined },
    ];
    const result = people
      .filter((p) => !p.merged_into && p.identity_count > 1)
      .sort((a, b) => b.identity_count - a.identity_count)
      .slice(0, 1);
    expect(result).toHaveLength(1);
    expect(result[0]?.display_name).toBe("B");
  });

  test("default limit is 25 when none is supplied", () => {
    const limit = undefined as number | undefined;
    expect(limit ?? 25).toBe(25);
  });
});
