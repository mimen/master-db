import { describe, expect, test } from "bun:test";

import { isLateTurn, rowSignal } from "./row-signal";

const flags = { unresponded: false };

describe("rowSignal", () => {
  test("unread wins over unresponded", () => {
    expect(rowSignal({ unreadCount: 2, flags: { unresponded: true } })).toBe("unread");
  });

  test("unresponded does not create a row badge", () => {
    expect(rowSignal({ unreadCount: 0, flags: { unresponded: true } })).toBeNull();
  });

  test("empty when no signal applies", () => {
    expect(rowSignal({ unreadCount: 0, flags })).toBeNull();
  });
});

describe("isLateTurn", () => {
  const now = 1_000_000_000_000;
  const hours = (h: number) => ({ dateCreated: now - h * 3_600_000 });
  test("late at 48h of your turn, not before", () => {
    expect(isLateTurn({ flags: { unresponded: true }, lastMessage: hours(48) }, now)).toBe(true);
    expect(isLateTurn({ flags: { unresponded: true }, lastMessage: hours(47.9) }, now)).toBe(false);
  });
  test("never late when it is not your turn", () => {
    expect(isLateTurn({ flags: { unresponded: false }, lastMessage: hours(100) }, now)).toBe(false);
  });
});
