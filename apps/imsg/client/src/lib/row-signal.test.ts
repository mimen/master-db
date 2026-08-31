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

  test("unresponded and archived do not create row badges", () => {
    expect(
      rowSignal({ unreadCount: 0, flags: { unresponded: true, archived: true } }),
    ).toBeNull();
  });

  test("archived does not create a row badge", () => {
    expect(rowSignal({ unreadCount: 0, flags: { ...flags, archived: true } })).toBeNull();
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
