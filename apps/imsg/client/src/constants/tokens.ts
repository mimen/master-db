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
 * The one semantic palette: Signal. Pure neutral with one persimmon accent
 * that marks your-turn time (`turn`), the active lens (`lensBar`) and keyboard
 * focus (`focusRing`). `accent` stays iMessage blue: it is the sent bubble,
 * the unread dot and links, not chrome. Every text token was measured at
 * 4.5:1 or better on `background`, `thread` and `surface` in its scheme
 * (artifacts/2026-10-04-design-overhaul/round4/contrast.mjs).
 */
export const Palette = {
  light: {
    text: "#17171A",
    textSecondary: "#55555C",
    textTertiary: "#64646B",
    /** The sidebar page and every sheet. */
    background: "#FFFFFF",
    /** The gray the thread sits on. */
    thread: "#F4F4F5",
    surface: "#FFFFFF",
    icon: "#5E5E66",
    accent: "#007AFF",
    accentTint: "rgba(0,122,255,0.10)",
    turn: "#BE3A06",
    onTurn: "#FFFFFF",
    turnMark: "#EC5A1E",
    lensBar: "#EC5A1E",
    focusRing: "#E0500F",
    success: "#1F7A35",
    warning: "#C93400",
    destructive: "#C4261B",
  },
  dark: {
    text: "#EDEDEF",
    textSecondary: "#A6A6AD",
    textTertiary: "#8F8F96",
    background: "#141416",
    thread: "#0F0F11",
    surface: "#1C1C1F",
    icon: "#97979E",
    accent: "#0A84FF",
    accentTint: "rgba(10,132,255,0.18)",
    turn: "#FF8A57",
    onTurn: "#1A0B03",
    turnMark: "#FF6A2B",
    lensBar: "#FF6A2B",
    focusRing: "#FF7A40",
    success: "#30D158",
    warning: "#FF9F0A",
    destructive: "#FF6B5E",
  },
} as const;

export const Colors = {
  light: {
    ...Palette.light,
    cardBorder: "rgba(0,0,0,0.075)",
    /** Search fields and resting control fills. */
    field: "rgba(0,0,0,0.045)",
    rowHover: "rgba(0,0,0,0.04)",
    rowSelected: "rgba(0,0,0,0.075)",
    /** Opaque raised fill for chips and floating labels. */
    backgroundElement: "#F4F4F5",
    backgroundSelected: "#E4E4E7",
    // Sent bubbles keep Messages.app's blue and green on purpose: white text measures 4.0:1 on
    // the blue and 2.2:1 on the green. The owner chose parity over AA here (2026-10-04).
    bubbleMine: Palette.light.accent,
    bubbleTheirs: "#FFFFFF",
    bubbleTheirsBorder: "rgba(0,0,0,0.07)",
    bubbleTheirsText: Palette.light.text,
    divider: "rgba(0,0,0,0.075)",
    dividerStrong: "rgba(0,0,0,0.13)",
    // "This will send as SMS" tint.
    sms: "#34C759",
    avatar: ["#ECECEE", "#E6E6E9", "#EFEFF1", "#E9E9EC", "#EDEDEF", "#E7E7EA"],
    avatarText: "#3C3C42",
    swipeIdle: "#E4E4E7",
    onSwipeIdle: "#4A4A50",
    swipeSettle: "#17171A",
    swipeUnread: "#0B5FCC",
    onSwipe: "#FFFFFF",
    barBg: "rgba(255,255,255,0.88)",
    barShadow: "0 1px 0 rgba(0,0,0,0.04), 0 10px 28px -12px rgba(0,0,0,0.3)",
    // Text and icons drawn on an accent, destructive or sms fill.
    onAccent: "#fff",
    // A fill white text sits on (5.4:1); success itself is a text color in dark.
    successFill: Palette.light.success,
    backdrop: "rgba(23,23,26,0.16)",
    /** Popovers: menus, the command palette, dropdown lists. */
    popBg: "#FFFFFF",
    popShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 18px 48px -12px rgba(0,0,0,0.28)",
    popSelected: "rgba(0,0,0,0.075)",
    popTertiary: "#64646B",
    skeleton: "rgba(0,0,0,0.06)",
    tapbackBg: "#FFFFFF",
    tapbackBorder: "rgba(0,0,0,0.1)",
    disabled: "#A2A2A8",
    switchOn: "#17171A",
    switchOff: "#8E8E95",
    chipBg: "#FFFFFF",
    chipBorder: "rgba(0,0,0,0.13)",
    /** The state strip on top of the composer card. */
    strip: "#FFFFFF",
    toastBg: "#17171A",
    toastText: "#FFFFFF",
    toastAction: "#FFB08A",
    toastActionHover: "rgba(255,255,255,0.1)",
  },
  dark: {
    ...Palette.dark,
    cardBorder: "rgba(255,255,255,0.07)",
    field: "rgba(255,255,255,0.06)",
    rowHover: "rgba(255,255,255,0.045)",
    rowSelected: "rgba(255,255,255,0.085)",
    backgroundElement: "#232326",
    backgroundSelected: "#2A2A2E",
    bubbleMine: Palette.dark.accent,
    bubbleTheirs: "#232326",
    bubbleTheirsBorder: "rgba(255,255,255,0.05)",
    bubbleTheirsText: Palette.dark.text,
    divider: "rgba(255,255,255,0.07)",
    dividerStrong: "rgba(255,255,255,0.12)",
    sms: "#30D158",
    avatar: ["#2A2A2E", "#2E2E33", "#28282C", "#2C2C31", "#303035", "#29292D"],
    avatarText: "#D6D6DB",
    swipeIdle: "#2A2A2E",
    onSwipeIdle: "#C4C4CA",
    swipeSettle: "#EDEDEF",
    swipeUnread: "#4BA3FF",
    onSwipe: "#141416",
    barBg: "rgba(28,28,31,0.88)",
    barShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 12px 30px -10px rgba(0,0,0,0.75)",
    onAccent: "#fff",
    successFill: Palette.light.success,
    backdrop: "rgba(0,0,0,0.5)",
    popBg: "#232326",
    popShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 18px 48px -12px rgba(0,0,0,0.8)",
    popSelected: "rgba(255,255,255,0.06)",
    popTertiary: "#A0A0A7",
    skeleton: "rgba(255,255,255,0.07)",
    tapbackBg: "#2C2C30",
    tapbackBorder: "rgba(255,255,255,0.08)",
    disabled: "#5E5E64",
    switchOn: "#EDEDEF",
    switchOff: "#727279",
    chipBg: "#1C1C1F",
    chipBorder: "rgba(255,255,255,0.12)",
    strip: "#19191C",
    toastBg: "#EDEDEF",
    toastText: "#17171A",
    toastAction: "#B23A06",
    toastActionHover: "rgba(0,0,0,0.06)",
  },
} as const;
