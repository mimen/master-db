import { describe, expect, test } from "bun:test";

import { TriageGeometry, TriageTheme } from "./triage-theme";
import { Colors, Palette, Radius, Space, TypeRamp, Weight } from "./tokens";
import { DesktopType, Type } from "./type-scale";

describe("type ramp", () => {
  test("desktop is the dense Mac ramp", () => {
    expect(TypeRamp.desktop).toEqual({ caption: 11, secondary: 12, body: 13, title: 15, display: 20 });
  });

  test("mobile never renders smaller than desktop", () => {
    for (const rung of ["caption", "secondary", "body", "title", "display"] as const) {
      expect(TypeRamp.mobile[rung]).toBeGreaterThanOrEqual(TypeRamp.desktop[rung]);
    }
  });

  test("legacy names read the ramp", () => {
    expect(DesktopType).toEqual({ caption: 10, secondary: 12, body: 13, title: 14, display: 20 });
    expect(Type.body).toBe(16);
    expect(Type.title).toBe(17);
  });

  test("two weights", () => {
    expect(Object.values(Weight)).toEqual(["400", "600"]);
  });
});

describe("scale", () => {
  test("spacing and radii are the agreed steps", () => {
    expect(Object.values(Space)).toEqual([2, 4, 6, 8, 12, 16, 20, 24, 32, 16]);
    expect(Radius).toEqual({ sm: 6, md: 10, lg: 16, full: 9999 });
  });
});

describe("legacy aliases keep their shipped values", () => {
  test("Colors carries the semantic palette in both schemes", () => {
    expect(Colors.light.textSecondary).toBe("#60646C");
    expect(Colors.dark.textSecondary).toBe("#98989e");
    expect(Colors.light.destructive).toBe("#D70015");
    expect(Colors.dark.destructive).toBe("#FF453A");
    expect(Colors.light.bubbleMine).toBe("#007AFF");
    expect(Colors.dark.accentTint).toBe(Palette.dark.accentTint);
    expect(Colors.light.success).toBe("#1F7A35");
  });

  test("TriageTheme reads the palette where the values already agreed", () => {
    expect(TriageTheme.dark.meta).toBe("#98989e");
    expect(TriageTheme.dark.text).toBe("#ffffff");
    expect(TriageTheme.light.desk).toBe("#e6e7ee");
    expect(TriageTheme.light.text).toBe("#1a1a1c");
    expect(TriageGeometry.rowGap).toBe(6);
  });
});
