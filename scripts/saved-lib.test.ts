import { describe, expect, test } from "vitest";

import { takeUntilKnown } from "./saved-lib";
import { parseResults } from "./saved-triage";

describe("takeUntilKnown", () => {
  const id = (s: string) => s;

  test("stops at the first stored id and drops it and everything older", () => {
    expect(takeUntilKnown(["n3", "n2", "old1", "n1"], id, new Set(["old1"]))).toEqual({ fresh: ["n3", "n2"], done: true });
  });

  test("a page with nothing stored keeps paging", () => {
    expect(takeUntilKnown(["a", "b"], id, new Set())).toEqual({ fresh: ["a", "b"], done: false });
  });

  test("a stored newest post means nothing to import", () => {
    expect(takeUntilKnown(["a", "b"], id, new Set(["a"]))).toEqual({ fresh: [], done: true });
  });
});

describe("parseResults", () => {
  const batch = [
    { platform: "x" as const, platform_id: "1", url: "u", links: [], collections: [] },
    { platform: "instagram" as const, platform_id: "C", url: "u", links: [], collections: [] },
  ];

  test("keeps valid rows, takes the platform from the batch, and drops unknown ids and bad suggestions", () => {
    const text = `Here you go:\n[{"platform_id":"1","summary":"A tool","tags":["AI Agents"," x "],"suggestion":"try this tool"},
      {"platform_id":"C","summary":"Meme","tags":[],"suggestion":"archive"},
      {"platform_id":"zzz","summary":"?","tags":[],"suggestion":"drop"}]`;
    expect(parseResults(text, batch)).toEqual([
      { platform: "x", platform_id: "1", summary: "A tool", tags: ["ai agents", "x"], suggestion: "try this tool" },
    ]);
  });
});
