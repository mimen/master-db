import { describe, expect, test } from "bun:test";
import { formatRecordingClock, voiceMemoOutcome } from "./voice-memo";

describe("voice memo outcome", () => {
  test("a click-length press is discarded instead of sending an empty memo", () => {
    expect(voiceMemoOutcome("send", 0)).toBe("discard");
    expect(voiceMemoOutcome("send", 499)).toBe("discard");
  });

  test("a long-enough take sends", () => {
    expect(voiceMemoOutcome("send", 500)).toBe("send");
    expect(voiceMemoOutcome("send", 12_000)).toBe("send");
  });

  test("cancel always discards, however long the take", () => {
    expect(voiceMemoOutcome("cancel", 30_000)).toBe("discard");
  });

  test("the timer reads as m:ss", () => {
    expect(formatRecordingClock(0)).toBe("0:00");
    expect(formatRecordingClock(9_999)).toBe("0:09");
    expect(formatRecordingClock(75_000)).toBe("1:15");
  });
});
