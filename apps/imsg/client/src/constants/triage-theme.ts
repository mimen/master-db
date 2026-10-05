import { Colors, Space } from "./tokens";

const light = Colors.light;
const dark = Colors.dark;

/** Desk surfaces, read through `useTriageTheme()`. Every value comes from the Signal palette. */
export const TriageTheme = {
  light: {
    desk: light.thread,
    queue: light.background,
    inspector: light.background,
    overlay: light.background,
    card: light.surface,
    cardHover: light.rowHover,
    cardSelected: light.rowSelected,
    empty: light.thread,
    text: light.text,
    snippet: light.textSecondary,
    meta: light.textTertiary,
    muted: light.textSecondary,
    hint: light.textTertiary,
    hairline: light.divider,
    hairlineStrong: light.dividerStrong,
    controlFill: light.field,
    controlFillHover: light.rowSelected,
    cardShadow: "rgba(0,0,0,0.06)",
  },
  dark: {
    desk: dark.thread,
    queue: dark.background,
    inspector: dark.background,
    overlay: dark.background,
    card: dark.surface,
    cardHover: dark.rowHover,
    cardSelected: dark.rowSelected,
    empty: dark.thread,
    text: dark.text,
    snippet: dark.textSecondary,
    meta: dark.textTertiary,
    muted: dark.textSecondary,
    hint: dark.textTertiary,
    hairline: dark.divider,
    hairlineStrong: dark.dividerStrong,
    controlFill: dark.field,
    controlFillHover: dark.rowSelected,
    cardShadow: "rgba(0,0,0,0.40)",
  },
} as const;

export type TriageThemeValue = (typeof TriageTheme)[keyof typeof TriageTheme];

export const TriageGeometry = {
  queueWidth: 352,
  inspectorWidth: 312,
  rowHeight: 62,
  /** Rows are inset pills: 8px from the sidebar edge, 4px apart. */
  rowRadius: 10,
  rowRadiusMobile: 14,
  rowGap: Space.xs,
  listGutter: 8,
  threadHeaderHeight: 48,
  threadMaxWidth: 760,
} as const;
