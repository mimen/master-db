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

describe("Signal palette", () => {
  test("sent bubbles keep iMessage blue and SMS green; theirs is white on the gray thread", () => {
    expect([Colors.light.bubbleMine, Colors.dark.bubbleMine]).toEqual(["#007AFF", "#0A84FF"]);
    expect(Colors.light.sms).toBe("#34C759");
    expect(Colors.light.bubbleTheirs).toBe("#FFFFFF");
    expect(Colors.light.thread).toBe("#F4F4F5");
  });

  test("persimmon is the focus ring and lens bar, never the sent bubble", () => {
    expect(Palette.light.focusRing).toBe("#E0500F");
    expect(Palette.dark.focusRing).toBe("#FF7A40");
    expect(Colors.light.bubbleMine).not.toBe(Palette.light.lensBar);
  });

  test("TriageTheme reads the palette", () => {
    expect(TriageTheme.light.desk).toBe(Colors.light.thread);
    expect(TriageTheme.dark.text).toBe(Colors.dark.text);
    expect(TriageTheme.light.cardSelected).toBe("rgba(0,0,0,0.075)");
    expect(TriageGeometry.rowGap).toBe(4);
    expect(TriageGeometry.rowRadius).toBe(10);
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("text contrast", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: every text token clears 4.5:1 on the page, the thread and a surface`, () => {
      const c = Colors[scheme];
      const failures: string[] = [];
      for (const fg of ["text", "textSecondary", "textTertiary", "turn", "destructive", "avatarText"] as const) {
        for (const bg of ["background", "thread", "surface"] as const) {
          const ratio = contrast(c[fg], c[bg]);
          if (ratio < 4.5) failures.push(`${fg} on ${bg} ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});
