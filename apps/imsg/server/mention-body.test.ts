import { describe, expect, test } from "bun:test";
import { buildMentionAttributedBody } from "./mention-body";

describe("mention attributed bodies", () => {
  test("emits text and mention runs with Apple message-part attributes", () => {
    const text = "Hi Alex and Sam";
    expect(buildMentionAttributedBody(text, [
      { start: 3, length: 4, address: "+15550001111" },
      { start: 12, length: 3, address: "sam@example.com" },
    ])).toEqual({
      ok: true,
      value: {
        string: text,
        runs: [
          { range: [0, 3], attributes: { __kIMMessagePartAttributeName: 0 } },
          {
            range: [3, 4],
            attributes: {
              __kIMMessagePartAttributeName: 0,
              __kIMMentionConfirmedMention: "+15550001111",
            },
          },
          { range: [7, 5], attributes: { __kIMMessagePartAttributeName: 0 } },
          {
            range: [12, 3],
            attributes: {
              __kIMMessagePartAttributeName: 0,
              __kIMMentionConfirmedMention: "sam@example.com",
            },
          },
        ],
      },
    });
  });

  test("keeps UTF-16 offsets after surrogate-pair emoji", () => {
    const result = buildMentionAttributedBody("👋 Alex", [
      { start: 3, length: 4, address: "alex@example.com" },
    ]);
    expect(result.ok && result.value.runs?.[1]?.range).toEqual([3, 4]);
  });

  test("rejects overlapping or out-of-bounds ranges", () => {
    expect(buildMentionAttributedBody("Alex", [
      { start: 0, length: 3, address: "a" },
      { start: 2, length: 2, address: "b" },
    ])).toEqual({ ok: false, error: "mention ranges overlap" });
    expect(buildMentionAttributedBody("Alex", [{ start: 3, length: 4, address: "a" }])).toEqual({
      ok: false,
      error: "mention range is outside the message",
    });
  });
});
