/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    desk: '#e6e7ee',
    cardBorder: 'rgba(0,0,0,0.08)',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    accent: '#007AFF',
    bubbleMine: '#007AFF',
    bubbleTheirs: '#E9E9EB',
    bubbleTheirsText: '#000000',
    divider: '#E5E5EA',
    // iOS system red (light).
    destructive: '#FF3B30',
    // iOS system green, used for the "this will send as SMS" affordance (bubble
    // tint + send-button tint). Same literal on both schemes today — flipping it
    // to the iOS dark-mode green (#30D158) would change current dark rendering,
    // which is out of scope for this sweep.
    sms: '#34C759',
    // Text/icons drawn on top of an accent/destructive/sms-colored surface —
    // correct in both schemes by definition, so it doesn't fork like the rest.
    onAccent: '#fff',
    // Modal scrim. Several call sites use other alphas (0.35, 0.4, 0.95) for
    // lighter/heavier overlays — those are left as literals, not forced to match.
    backdrop: 'rgba(0,0,0,0.45)',
  },
  dark: {
    // Apple Messages dark isn't pure black — panels sit on an elevated gray with
    // lighter incoming bubbles that pop off the ground.
    text: '#ffffff',
    background: '#1a1a1c',
    desk: '#0b0b0d',
    cardBorder: 'rgba(255,255,255,0.07)',
    backgroundElement: '#2c2c2e',
    backgroundSelected: '#3a3a3c',
    textSecondary: '#98989e',
    accent: '#0A84FF',
    bubbleMine: '#0A84FF',
    bubbleTheirs: '#363638',
    bubbleTheirsText: '#ffffff',
    divider: '#38383a',
    // iOS system red (dark).
    destructive: '#FF453A',
    sms: '#34C759',
    onAccent: '#fff',
    backdrop: 'rgba(0,0,0,0.45)',
  },
} as const;

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

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;

// Recurring corner radii, named for the surface they came from — not an ideal
// scale. Plenty of one-off radii remain in components (avatar circles computed
// from size/2, badge/pill shapes, etc.); only exact matches to these were swept.
export const Radii = {
  /** Chips, small icon buttons, compact rows. */
  chip: 10,
  /** Text inputs, save buttons, small cards. */
  input: 12,
  /** Message bubbles, medium cards. */
  card: 14,
} as const;

// Recurring font sizes pulled from actual usage. Many other sizes (10, 12, 14,
// 15, 18, 20...) remain as literals — this is the pattern, not the full scale.
export const Type = {
  /** Sheet/section titles, primary action labels. */
  title: 17,
  /** Message text, standard body copy. */
  body: 16,
  /** Secondary/meta text (timestamps, subtitles). */
  secondary: 13,
  /** Captions, badges, smallest legible text. */
  caption: 11,
} as const;

// Layout breakpoints used to switch between compact/wide UI. Kept here so the
// numbers have a canonical home; `hooks/use-layout-mode.ts` is the only place
// that reads them directly — everything else calls `useLayoutMode()`.
export const Breakpoints = {
  wide: 768,
  shadow: 1040,
} as const;

// The one piece of the card-shadow recipe that's genuinely identical everywhere
// it's used — shadowOffset/shadowOpacity/shadowRadius vary per surface and are
// intentionally NOT folded in here. Spread into a StyleSheet entry:
// `{ ...CardShadow, shadowOffset: {...}, shadowOpacity: ..., shadowRadius: ... }`
export const CardShadow = {
  shadowColor: '#000',
} as const;
