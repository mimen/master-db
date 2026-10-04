// The design-system scale. Pure (no react-native import) so bun tests and
// pure helpers can read it. Components reach these through `theme.ts`.

/** Spacing steps. `gutter` is the one horizontal inset every pane uses. */
export const Space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  x3: 24,
  x4: 32,
  gutter: 16,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
} as const;

/** The only two weights. Anything heavier than 600 folds into semibold. */
export const Weight = {
  regular: "400",
  semibold: "600",
} as const;

export interface TypeRampScale {
  readonly caption: number;
  readonly secondary: number;
  readonly body: number;
  readonly title: number;
  readonly display: number;
}

/** Desktop is the dense Mac ramp; mobile keeps iOS reading sizes. */
export const TypeRamp: { readonly desktop: TypeRampScale; readonly mobile: TypeRampScale } = {
  desktop: { caption: 11, secondary: 12, body: 13, title: 15, display: 20 },
  mobile: { caption: 11, secondary: 13, body: 16, title: 17, display: 22 },
};

/**
 * The one semantic palette. Text tokens pass 4.5:1 on `background` in their
 * scheme (textSecondary 5.94 / 6.06, textTertiary 5.07 / 5.06, success 5.39 /
 * 8.60, warning 5.28 / 8.45).
 */
export const Palette = {
  light: {
    text: "#000000",
    textSecondary: "#60646C",
    textTertiary: "#6e6e73",
    background: "#ffffff",
    desk: "#e6e7ee",
    accent: "#007AFF",
    accentTint: "rgba(0,122,255,0.10)",
    success: "#1F7A35",
    warning: "#C93400",
    destructive: "#D70015",
  },
  dark: {
    text: "#ffffff",
    textSecondary: "#98989e",
    textTertiary: "#8a8a90",
    background: "#1a1a1c",
    desk: "#0b0b0d",
    accent: "#0A84FF",
    accentTint: "rgba(10,132,255,0.18)",
    success: "#30D158",
    warning: "#FF9F0A",
    destructive: "#FF453A",
  },
} as const;

export const Colors = {
  light: {
    ...Palette.light,
    cardBorder: "rgba(0,0,0,0.08)",
    backgroundElement: "#F0F0F3",
    backgroundSelected: "#E0E1E6",
    // Sent bubbles keep Messages.app's blue and green on purpose: white text measures 4.0:1 on
    // the blue and 2.2:1 on the green. The owner chose parity over AA here (2026-10-04).
    bubbleMine: Palette.light.accent,
    bubbleTheirs: "#E9E9EB",
    bubbleTheirsText: Palette.light.text,
    divider: "#E5E5EA",
    // "This will send as SMS" tint. The same literal on both schemes today.
    sms: "#34C759",
    // Text and icons drawn on an accent, destructive or sms fill.
    onAccent: "#fff",
    // A fill white text sits on (5.4:1); success itself is a text color in dark.
    successFill: Palette.light.success,
    backdrop: "rgba(0,0,0,0.45)",
  },
  dark: {
    ...Palette.dark,
    cardBorder: "rgba(255,255,255,0.07)",
    backgroundElement: "#2c2c2e",
    backgroundSelected: "#3a3a3c",
    bubbleMine: Palette.dark.accent,
    bubbleTheirs: "#363638",
    bubbleTheirsText: Palette.dark.text,
    divider: "#38383a",
    sms: "#34C759",
    onAccent: "#fff",
    successFill: Palette.light.success,
    backdrop: "rgba(0,0,0,0.45)",
  },
} as const;
