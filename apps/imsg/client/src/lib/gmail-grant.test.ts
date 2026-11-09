import { describe, expect, test } from "bun:test";

import { grantEnded, reconnectCaption } from "./gmail-grant";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("reconnectCaption", () => {
  test("counts whole days down from a fresh grant, then hours on the last day, then says it ended", () => {
    expect(reconnectCaption(7 * DAY, 1)).toBe("Reconnect within 7 days, Google's weekly limit.");
    expect(reconnectCaption(DAY + 1, 0)).toBe("Reconnect within 2 days, Google's weekly limit.");
    expect(reconnectCaption(DAY, 0)).toBe("Reconnect within 1 day, Google's weekly limit.");
    expect(reconnectCaption(5 * HOUR, 0)).toBe("Reconnect within 5 hours, Google's weekly limit.");
    expect(reconnectCaption(1, 0)).toBe("Reconnect within 1 hour, Google's weekly limit.");
    expect(reconnectCaption(0, 0)).toBe("Google ended this week's access. Reconnect to keep reading.");
  });

  test("a grant ends at its time; a mailbox without one never does", () => {
    expect(grantEnded(10, 9)).toBe(false);
    expect(grantEnded(10, 10)).toBe(true);
    expect(grantEnded(undefined, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
