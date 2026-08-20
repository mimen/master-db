import { describe, expect, test } from "bun:test";

import { ROW_SIGNAL_SIZE, rowSignal, unreadLabel } from "./row-signal";

const flags = { unresponded: false, archived: false };

describe("rowSignal", () => {
  test("unread wins over unresponded and archived", () => {
    expect(
      rowSignal({
        unreadCount: 2,
        flags: { unresponded: true, archived: true },
      }),
    ).toBe("unread");
  });

  test("unresponded wins over archived when nothing is unread", () => {
    expect(
      rowSignal({ unreadCount: 0, flags: { unresponded: true, archived: true } }),
    ).toBe("unresponded");
  });

  test("archived shows when it is the only flag", () => {
    expect(rowSignal({ unreadCount: 0, flags: { ...flags, archived: true } })).toBe("archived");
  });

  test("empty when no signal applies", () => {
    expect(rowSignal({ unreadCount: 0, flags })).toBeNull();
  });
});

describe("unreadLabel", () => {
  test("caps at 99+", () => {
    expect(unreadLabel(1)).toBe("1");
    expect(unreadLabel(12)).toBe("12");
    expect(unreadLabel(99)).toBe("99");
    expect(unreadLabel(100)).toBe("99+");
  });
});

test("signal disc is a fixed square", () => {
  expect(ROW_SIGNAL_SIZE).toBe(20);
});
