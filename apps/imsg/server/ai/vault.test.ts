import { describe, expect, test } from "bun:test";
import { parseRipgrepOutput } from "./vault";

describe("parseRipgrepOutput", () => {
  test("parses path:lineno:text into path and line", () => {
    const hits = parseRipgrepOutput("/vault/People/Sarah.md:12:phone: 415-555-0000");
    expect(hits).toEqual([{ path: "/vault/People/Sarah.md", line: "phone: 415-555-0000" }]);
  });

  test("keeps colons that appear in the matched text", () => {
    const hits = parseRipgrepOutput("/v/note.md:3:url: https://example.com:8080/x");
    expect(hits[0]?.path).toBe("/v/note.md");
    expect(hits[0]?.line).toBe("url: https://example.com:8080/x");
  });

  test("skips blank and malformed lines", () => {
    const hits = parseRipgrepOutput("\n/v/a.md:1:hit\ngarbage-without-colons\n\n");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe("/v/a.md");
  });

  test("respects the limit", () => {
    const raw = Array.from({ length: 30 }, (_, i) => `/v/n${i}.md:1:x`).join("\n");
    expect(parseRipgrepOutput(raw, 5)).toHaveLength(5);
  });

  test("returns nothing for empty input", () => {
    expect(parseRipgrepOutput("")).toEqual([]);
  });
});
