import { describe, expect, test } from "bun:test";
import { mentionQueryAt, reconcileMentionAnnotations, trimMentionAnnotations } from "./mentions";

describe("editable mention annotations", () => {
  test("shifts mentions when text changes before them", () => {
    expect(
      reconcileMentionAnnotations("Hi Alex", "Well, hi Alex", [
        { start: 3, length: 4, address: "alex" },
      ]),
    ).toEqual([{ start: 9, length: 4, address: "alex" }]);
  });

  test("invalidates a mention when editing or deleting inside it", () => {
    const mention = [{ start: 3, length: 4, address: "alex" }];
    expect(reconcileMentionAnnotations("Hi Alex", "Hi Alix", mention)).toEqual([]);
    expect(reconcileMentionAnnotations("Hi Alex", "Hi Aex", mention)).toEqual([]);
    expect(reconcileMentionAnnotations("Hi Alex", "Hi AlXex", mention)).toEqual([]);
  });

  test("keeps a mention when appending at its end", () => {
    expect(
      reconcileMentionAnnotations("Alex", "Alex!", [{ start: 0, length: 4, address: "alex" }]),
    ).toEqual([{ start: 0, length: 4, address: "alex" }]);
  });
});

describe("mention query detection", () => {
  test("finds a token at the cursor and rejects email-like at signs", () => {
    expect(mentionQueryAt("Hello @al", 9)).toEqual({ start: 6, end: 9, query: "al" });
    expect(mentionQueryAt("me@example.com", 14)).toBeNull();
    expect(mentionQueryAt("Hello @al there", 15)).toBeNull();
  });
});


test("trims message whitespace while preserving mention offsets", () => {
  expect(trimMentionAnnotations("  Hi Alex  ", [{ start: 5, length: 4, address: "alex" }])).toEqual({
    text: "Hi Alex",
    mentions: [{ start: 3, length: 4, address: "alex" }],
  });
});
