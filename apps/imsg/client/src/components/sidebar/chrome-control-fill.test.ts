import { describe, expect, test } from "bun:test";

import { chromeControlFill } from "./chrome-control-fill";

const theme = {
  backgroundElement: "#F0F0F3",
  backgroundSelected: "#E0E1E6",
};

describe("chromeControlFill", () => {
  test("idle is unfilled", () => {
    expect(chromeControlFill(theme, { hovered: false, pressed: false })).toBeUndefined();
  });

  test("hover fills with the element color", () => {
    expect(chromeControlFill(theme, { hovered: true, pressed: false })).toEqual({
      backgroundColor: theme.backgroundElement,
    });
  });

  test("press wins over hover", () => {
    expect(chromeControlFill(theme, { hovered: true, pressed: true })).toEqual({
      backgroundColor: theme.backgroundSelected,
    });
  });
});
