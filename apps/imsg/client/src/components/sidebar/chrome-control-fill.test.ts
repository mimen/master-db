import { describe, expect, test } from "bun:test";

import { chromeControlFill, filterChipFill } from "./chrome-control-fill";
import { HOVER_DIM, PRESS_DIM } from "@/constants/interaction";

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

describe("filterChipFill", () => {
  const chipTheme = { ...theme, text: "#000000" };

  test("selected inverts, hover dims", () => {
    expect(filterChipFill(chipTheme, { selected: true, hovered: false, pressed: false })).toEqual({
      backgroundColor: "#000000",
      opacity: 1,
    });
    expect(filterChipFill(chipTheme, { selected: true, hovered: true, pressed: false }).opacity).toBe(HOVER_DIM);
    expect(filterChipFill(chipTheme, { selected: true, hovered: true, pressed: true }).opacity).toBe(PRESS_DIM);
  });

  test("unselected hover uses the selected-chip fill", () => {
    expect(filterChipFill(chipTheme, { selected: false, hovered: true, pressed: false })).toEqual({
      backgroundColor: theme.backgroundSelected,
    });
    expect(filterChipFill(chipTheme, { selected: false, hovered: false, pressed: false })).toEqual({
      backgroundColor: theme.backgroundElement,
    });
  });
});
