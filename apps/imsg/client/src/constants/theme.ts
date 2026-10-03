import '@/global.css';

import { Platform } from 'react-native';

import { Colors, Radius, Space } from './tokens';

export { Colors, Palette, Radius, Space, TypeRamp, Weight, type TypeRampScale } from './tokens';

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** Legacy names for `Space`. New code reads `Space`. */
export const Spacing = {
  half: Space.xxs,
  one: Space.xs,
  two: Space.md,
  three: Space.xl,
  four: Space.x3,
  five: Space.x4,
  six: 64,
} as const;

export const MaxContentWidth = 800;

/**
 * Legacy surface-named radii, kept at their shipped values so no caller moves
 * before the migration wave. New code reads `Radius`.
 */
export const Radii = {
  chip: Radius.md,
  input: 12,
  card: 14,
} as const;

export { DesktopType, Type, type TypeScale } from "./type-scale";

// Layout breakpoints used to switch between compact/wide UI. Kept here so the
// numbers have a canonical home; `hooks/use-layout-mode.ts` is the only place
// that reads them directly — everything else calls `useLayoutMode()`.
export const Breakpoints = {
  wide: 768,
  shadow: 1040,
} as const;

export { HOVER_DIM, PRESS_DIM } from "./interaction";

// The one piece of the card-shadow recipe that's genuinely identical everywhere
// it's used — shadowOffset/shadowOpacity/shadowRadius vary per surface and are
// intentionally NOT folded in here. Spread into a StyleSheet entry:
// `{ ...CardShadow, shadowOffset: {...}, shadowOpacity: ..., shadowRadius: ... }`
export const CardShadow = {
  shadowColor: '#000',
} as const;
