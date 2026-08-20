/** Recurring font sizes pulled from actual usage. */
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

/** One step down from `Type` — iOS 17pt chrome is too big in a Mac window. */
export const DesktopType = {
  title: 14,
  body: 13,
  secondary: 12,
  caption: 10,
} as const;

export interface TypeScale {
  readonly title: number;
  readonly body: number;
  readonly secondary: number;
  readonly caption: number;
}
