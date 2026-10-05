import { describe, expect, test } from "bun:test";

import { initialIndex, menuKey, placeMenu } from "./dropdown-model";

describe("menuKey", () => {
  test("arrows step and clamp at both ends", () => {
    expect(menuKey("ArrowDown", 0, 3)).toEqual({ kind: "move", index: 1 });
    expect(menuKey("ArrowDown", 2, 3)).toEqual({ kind: "move", index: 2 });
    expect(menuKey("ArrowUp", 1, 3)).toEqual({ kind: "move", index: 0 });
    expect(menuKey("ArrowUp", 0, 3)).toEqual({ kind: "move", index: 0 });
  });

  test("Home and End jump to the ends", () => {
    expect(menuKey("Home", 2, 3)).toEqual({ kind: "move", index: 0 });
    expect(menuKey("End", 0, 3)).toEqual({ kind: "move", index: 2 });
  });

  test("Enter and Space select the highlighted option", () => {
    expect(menuKey("Enter", 1, 3)).toEqual({ kind: "select", index: 1 });
    expect(menuKey(" ", 2, 3)).toEqual({ kind: "select", index: 2 });
  });

  test("Escape and Tab close without choosing", () => {
    expect(menuKey("Escape", 1, 3)).toEqual({ kind: "close" });
    expect(menuKey("Tab", 1, 3)).toEqual({ kind: "close" });
    expect(menuKey("Escape", 0, 0)).toEqual({ kind: "close" });
  });

  test("other keys and an empty menu do nothing", () => {
    expect(menuKey("a", 1, 3)).toBeNull();
    expect(menuKey("ArrowDown", 0, 0)).toBeNull();
    expect(menuKey("Enter", 0, 0)).toBeNull();
  });
});

test("opening highlights the current value, falling back to the first option", () => {
  expect(initialIndex(["off", "on-demand", "auto"], "auto")).toBe(2);
  expect(initialIndex(["off", "on-demand"], "missing")).toBe(0);
});

describe("placeMenu", () => {
  const viewport = { width: 1440, height: 900 };

  test("sits under the field with its trailing edge aligned", () => {
    expect(placeMenu({ x: 900, y: 100, width: 196, height: 30 }, { width: 256, height: 120 }, viewport))
      .toEqual({ left: 840, top: 134 });
  });

  test("flips above when the bottom has no room", () => {
    expect(placeMenu({ x: 900, y: 820, width: 196, height: 30 }, { width: 196, height: 120 }, viewport))
      .toEqual({ left: 900, top: 696 });
  });

  test("stays below when neither side fits but below has more room", () => {
    expect(placeMenu({ x: 900, y: 100, width: 196, height: 30 }, { width: 196, height: 2000 }, viewport).top).toBe(134);
  });

  test("clamps inside the viewport's horizontal edges", () => {
    expect(placeMenu({ x: 4, y: 100, width: 100, height: 30 }, { width: 256, height: 60 }, viewport).left).toBe(8);
    expect(placeMenu({ x: 1300, y: 100, width: 196, height: 30 }, { width: 256, height: 60 }, viewport).left).toBe(1176);
  });
});
