import { describe, expect, test } from "bun:test";
import {
  contactCandidate,
  digitsKey,
  loosePhonePattern,
  mergeCandidates,
  vaultCandidates,
} from "./identify";

describe("digitsKey", () => {
  test("normalizes formatting to the last 10 digits", () => {
    expect(digitsKey("+1 (415) 555-0000")).toBe("4155550000");
    expect(digitsKey("415.555.0000")).toBe("4155550000");
    expect(digitsKey("14155550000")).toBe("4155550000");
  });

  test("rejects strings with too few digits to identify anyone", () => {
    expect(digitsKey("911")).toBeNull();
    expect(digitsKey("sarah@example.com")).toBeNull();
  });
});

describe("loosePhonePattern", () => {
  test("matches the same number written with different separators", () => {
    const re = new RegExp(loosePhonePattern("4155550000"));
    expect(re.test("call 415-555-0000 today")).toBe(true);
    expect(re.test("(415) 555 0000")).toBe(true);
    expect(re.test("4155550000")).toBe(true);
  });

  test("does not match a different number", () => {
    expect(new RegExp(loosePhonePattern("4155550000")).test("415-555-9999")).toBe(false);
  });
});

describe("vaultCandidates", () => {
  test("names candidates after the note containing the number", async () => {
    const result = await vaultCandidates("+1 415 555 0000", {
      search: async () => [{ path: "/vault/People/Sarah Chen.md", line: "phone: 415-555-0000" }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("Sarah Chen");
    expect(result[0]?.source).toBe("vault");
    expect(result[0]?.detail).toContain("People/Sarah Chen.md");
  });

  test("deduplicates repeat hits in the same note", async () => {
    const result = await vaultCandidates("4155550000", {
      search: async () => [
        { path: "/vault/People/Sarah Chen.md", line: "a" },
        { path: "/vault/People/Sarah Chen.md", line: "b" },
      ],
    });
    expect(result).toHaveLength(1);
  });

  test("caps candidates so the prompt cannot blow up", async () => {
    const result = await vaultCandidates("4155550000", {
      search: async () =>
        Array.from({ length: 10 }, (_, i) => ({ path: `/vault/People/P${i}.md`, line: "x" })),
    });
    expect(result).toHaveLength(3);
  });

  test("skips the search entirely for an unusable address", async () => {
    let called = false;
    const result = await vaultCandidates("nope", {
      search: async () => {
        called = true;
        return [];
      },
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("contactCandidate", () => {
  test("wraps a known name", () => {
    expect(contactCandidate("Dan")[0]?.source).toBe("contacts");
  });

  test("yields nothing for an unknown contact", () => {
    expect(contactCandidate(null)).toEqual([]);
  });
});

describe("mergeCandidates", () => {
  test("prefers earlier sources on a name collision", () => {
    const merged = mergeCandidates([
      [{ source: "contacts", name: "Sarah", detail: "address book" }],
      [{ source: "vault", name: "sarah", detail: "note" }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("contacts");
  });

  test("respects the limit", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      source: "vault",
      name: `P${i}`,
      detail: "x",
    }));
    expect(mergeCandidates([many], 5)).toHaveLength(5);
  });
});
