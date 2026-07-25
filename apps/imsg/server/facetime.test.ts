import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { createAndSendFaceTimeLink } from "./facetime";

describe("group FaceTime links", () => {
  test("creates through the seam and sends the returned link", async () => {
    const bb = new FakeBlueBubbles({
      chats: [{ guid: "iMessage;+;group", messages: [] }],
      faceTimeLink: "https://facetime.apple.com/join#abc",
    });
    const result = await createAndSendFaceTimeLink(bb, "iMessage;+;group");
    expect(result.ok).toBe(true);
    expect(bb.faceTimeLinkCalls).toBe(1);
    expect(bb.sentTexts).toEqual([
      { chatGuid: "iMessage;+;group", message: "https://facetime.apple.com/join#abc" },
    ]);
  });
});
