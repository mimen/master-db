import { describe, expect, test } from "bun:test";

import { rowSignal } from "./row-signal";

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

