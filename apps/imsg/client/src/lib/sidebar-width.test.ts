import { describe, expect, test } from "bun:test";

import {
  clampSidebarWidth,
  SIDEBAR_TITLE_HEIGHT,
  SIDEBAR_TOOLBAR_HEIGHT,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarChromeHeight,
} from "./sidebar-metrics";

describe("clampSidebarWidth", () => {
  test("passes through a value in range", () => {
    expect(clampSidebarWidth(400)).toBe(400);
  });

  test("clamps to min and max", () => {
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_MAX);
  });

  test("rounds and rejects non-finite", () => {
    expect(clampSidebarWidth(380.6)).toBe(381);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});

describe("sidebarChromeHeight", () => {
  test("mobile is the title row only", () => {
    expect(sidebarChromeHeight(false)).toBe(SIDEBAR_TITLE_HEIGHT);
  });

  test("wide stacks title and toolbar", () => {
    expect(sidebarChromeHeight(true)).toBe(SIDEBAR_TITLE_HEIGHT + SIDEBAR_TOOLBAR_HEIGHT);
  });
});
