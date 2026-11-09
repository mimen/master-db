import { describe, expect, test } from "bun:test";

import { rowSignal } from "./row-signal";
import { LATE_AFTER_MS } from "./turn-age";

const now = 1_000_000_000_000;
const fresh = { dateCreated: now - 60_000 };
const late = { dateCreated: now - LATE_AFTER_MS };

describe("rowSignal", () => {
  test("unread shows the dot", () => {
    expect(rowSignal({ unreadCount: 2, flags: { unresponded: true }, lastMessage: fresh }, { now })).toBe("dot");
  });

  test("a late turn colours the time instead, so it carries no dot", () => {
    expect(rowSignal({ unreadCount: 2, flags: { unresponded: true }, lastMessage: late }, { now })).toBeNull();
    expect(rowSignal({ unreadCount: 2, flags: { unresponded: false }, lastMessage: late }, { now })).toBe("dot");
  });

  test("lenses that already mean unread show a bold name, never the dot", () => {
    expect(rowSignal({ unreadCount: 1, flags: { unresponded: true }, lastMessage: late }, { now, boldUnread: true })).toBe("bold");
    expect(rowSignal({ unreadCount: 0, flags: { unresponded: true }, lastMessage: fresh }, { now, boldUnread: true })).toBeNull();
  });

  test("read rows carry no signal", () => {
    expect(rowSignal({ unreadCount: 0, flags: { unresponded: true }, lastMessage: fresh }, { now })).toBeNull();
  });
});
