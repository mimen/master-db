import { describe, expect, test } from "bun:test";

import { firstEmoji } from "./emoji";

describe("firstEmoji", () => {
  test("keeps each emoji grapheme whole", () => {
    for (const emoji of ["👍", "👍🏽", "❤️", "👨‍👩‍👧‍👦", "🧑🏽‍💻", "🇺🇸", "1️⃣", "#⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "🏳️‍🌈"]) {
      expect(firstEmoji(emoji)).toBe(emoji);
      expect(firstEmoji(`Reacted ${emoji} to "hi"`)).toBe(emoji);
    }
  });

  test("matches what a grapheme segmenter finds", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const text of ["ok 👋🏻 then 🎉", "flags 🇫🇷🇩🇪", "🤷‍♀️ shrug", "2 + 2 = 4 ✅"]) {
      const first = [...segmenter.segment(text)].map((s) => s.segment).find((s) => firstEmoji(s) === s);
      expect(firstEmoji(text)).toBe(first ?? null);
    }
  });

  test("ignores text without an emoji, including bare digits and symbols", () => {
    expect(firstEmoji("Loved 123 # *")).toBeNull();
    expect(firstEmoji("")).toBeNull();
  });
});
