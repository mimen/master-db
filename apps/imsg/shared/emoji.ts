// Hermes (iOS) has no Intl.Segmenter, so one emoji grapheme is matched by its sequence shape:
// a flag pair, a keycap, or pictographs with presentation selectors, skin tones and tag letters, joined by ZWJ.
const PART = String.raw`\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|[\u{E0020}-\u{E007F}])*`;
const EMOJI = new RegExp(
  String.raw`\p{Regional_Indicator}{1,2}|[0-9#*]️?⃣|${PART}(?:‍${PART})*`,
  "u",
);

/** The first emoji in text, whole: skin tones, ZWJ sequences, flags and keycaps stay one grapheme. */
export function firstEmoji(text: string): string | null {
  return EMOJI.exec(text)?.[0] ?? null;
}
