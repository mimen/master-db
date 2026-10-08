import { describe, expect, test } from "bun:test";

import { TAPBACK_LABEL, TAPBACKS, trayKey } from "./tapbacks";

describe("TAPBACKS", () => {
  test("keeps iMessage's tray order and names every tapback", () => {
    expect(TAPBACKS.map((t) => t.type)).toEqual(["love", "like", "dislike", "laugh", "emphasize", "question"]);
    expect(TAPBACK_LABEL.laugh).toBe("Laugh");
    expect(TAPBACK_LABEL.emoji).toBeUndefined();
  });
});

describe("trayKey", () => {
  test("left and right step and wrap around the tray", () => {
    expect(trayKey("ArrowRight", 2, 6)).toEqual({ kind: "move", index: 3 });
    expect(trayKey("ArrowRight", 5, 6)).toEqual({ kind: "move", index: 0 });
    expect(trayKey("ArrowLeft", 0, 6)).toEqual({ kind: "move", index: 5 });
  });

  test("an arrow from outside the tray enters it at the matching end", () => {
    expect(trayKey("ArrowRight", -1, 6)).toEqual({ kind: "move", index: 0 });
    expect(trayKey("ArrowLeft", -1, 6)).toEqual({ kind: "move", index: 5 });
  });

  test("Home and End jump to the ends", () => {
    expect(trayKey("Home", 4, 6)).toEqual({ kind: "move", index: 0 });
    expect(trayKey("End", 1, 6)).toEqual({ kind: "move", index: 5 });
  });

  test("Enter and Space pick the focused tapback, and nothing when focus is elsewhere", () => {
    expect(trayKey("Enter", 3, 6)).toEqual({ kind: "pick", index: 3 });
    expect(trayKey(" ", 0, 6)).toEqual({ kind: "pick", index: 0 });
    expect(trayKey("Enter", -1, 6)).toBeNull();
  });

  test("Escape closes; other keys pass through", () => {
    expect(trayKey("Escape", 2, 6)).toEqual({ kind: "close" });
    expect(trayKey("ArrowDown", 2, 6)).toBeNull();
    expect(trayKey("Tab", 2, 6)).toBeNull();
  });
});
