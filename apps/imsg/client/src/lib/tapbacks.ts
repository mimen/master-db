import type { TapbackType } from "@shared/types";

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
