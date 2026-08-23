import { describe, expect, test } from "bun:test";

import {
  calculatePaneAdmission,
  DESKTOP_DETAIL_MIN_WIDTH,
  DESKTOP_RAIL_WIDTH,
  DESKTOP_SIDE_PANE_WIDTH,
} from "./pane-admission";

describe("calculatePaneAdmission", () => {
  test("uses the fixed rail, actual sidebar, minimum detail, and 312px side pane", () => {
    expect(DESKTOP_RAIL_WIDTH).toBe(64);
    expect(DESKTOP_DETAIL_MIN_WIDTH).toBe(420);
    expect(DESKTOP_SIDE_PANE_WIDTH).toBe(312);

    expect(calculatePaneAdmission({ windowWidth: 1040, sidebarWidth: 352 })).toEqual({
      detailBudget: 624,
      spareAfterMinimumDetail: 204,
      sidePaneWidth: 312,
      sidePane: "overlay",
    });
    expect(calculatePaneAdmission({ windowWidth: 1148, sidebarWidth: 352 })).toEqual({
      detailBudget: 732,
      spareAfterMinimumDetail: 312,
      sidePaneWidth: 312,
      sidePane: "pane",
    });
  });

  test("accounts for a resized sidebar instead of a static window breakpoint", () => {
    expect(
      calculatePaneAdmission({ windowWidth: 1280, sidebarWidth: 352 }).sidePane,
    ).toBe("pane");
    expect(
      calculatePaneAdmission({ windowWidth: 1280, sidebarWidth: 560 }).sidePane,
    ).toBe("overlay");
    expect(
      calculatePaneAdmission({ windowWidth: 1512, sidebarWidth: 560 }).sidePane,
    ).toBe("pane");
  });

  test("admits exactly at the boundary and supports an explicit pane width", () => {
    expect(
      calculatePaneAdmission({
        windowWidth: 64 + 400 + 420 + 280,
        sidebarWidth: 400,
        sidePaneWidth: 280,
      }),
    ).toEqual({
      detailBudget: 700,
      spareAfterMinimumDetail: 280,
      sidePaneWidth: 280,
      sidePane: "pane",
    });
    expect(
      calculatePaneAdmission({
        windowWidth: 64 + 400 + 420 + 279,
        sidebarWidth: 400,
        sidePaneWidth: 280,
      }).sidePane,
    ).toBe("overlay");
  });
});
