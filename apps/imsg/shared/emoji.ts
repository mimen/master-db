const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const KEYCAP = /^[0-9#*]\uFE0F?\u20E3$/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The first emoji in text, whole: skin tones, ZWJ sequences, flags and keycaps stay one grapheme. */
export function firstEmoji(text: string): string | null {
  for (const { segment } of graphemes.segment(text)) {
    if (PICTOGRAPH.test(segment) || KEYCAP.test(segment)) return segment;
  }
  return null;
}
