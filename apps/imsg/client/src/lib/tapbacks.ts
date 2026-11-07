import { TAPBACK_GLYPHS } from "@shared/platform-profile";
import type { Reaction, TapbackType } from "@shared/types";

/** The six classic tapbacks in iMessage's tray order, with their spoken names. */
export const TAPBACKS: readonly { readonly type: TapbackType; readonly label: string }[] = [
  { type: "love", label: "Love" },
  { type: "like", label: "Like" },
  { type: "dislike", label: "Dislike" },
  { type: "laugh", label: "Laugh" },
  { type: "emphasize", label: "Emphasize" },
  { type: "question", label: "Question" },
];

/** Keyed by reaction type string, so chips can look up any type and fall back on a miss. */
export const TAPBACK_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  TAPBACKS.map(({ type, label }) => [type, label]),
);

export const TAPBACK_EMOJI: ReadonlyMap<string, string> = new Map(Object.entries(TAPBACK_GLYPHS));

/** How a reaction looks on any platform: its emoji, else a classic tapback's glyph, else its key. */
export function reactionGlyph(reaction: Pick<Reaction, "key" | "emoji">): string {
  return reaction.emoji ?? TAPBACK_EMOJI.get(reaction.key) ?? reaction.key;
}

/** The emoji the tray's picker offers before its field, most used first in Milad's chats. */
export const QUICK_EMOJI: readonly string[] = [
  "😂", "🙏", "🔥", "🥹", "😍", "🤣", "👍", "💙", "🫶", "👌", "😮", "😭",
  "🎉", "💯", "👀", "✨", "🙌", "😅", "🥲", "💀", "🤝", "😘", "🤔", "♥️",
];

export { firstEmoji } from "@shared/emoji";

export type TrayKeyResult = { kind: "move"; index: number } | { kind: "pick"; index: number } | { kind: "close" };

/** The horizontal tray's keys. `index` is the focused button, -1 when focus is outside the tray. */
export function trayKey(key: string, index: number, count: number): TrayKeyResult | null {
  switch (key) {
    case "ArrowRight":
      return { kind: "move", index: index < 0 ? 0 : (index + 1) % count };
    case "ArrowLeft":
      return { kind: "move", index: index < 0 ? count - 1 : (index - 1 + count) % count };
    case "Home":
      return { kind: "move", index: 0 };
    case "End":
      return { kind: "move", index: count - 1 };
    case "Enter":
    case " ":
      return index < 0 ? null : { kind: "pick", index };
    case "Escape":
      return { kind: "close" };
    default:
      return null;
  }
}
