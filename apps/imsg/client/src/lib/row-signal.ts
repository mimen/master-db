/** Trailing state disc on a conversation row. One slot, one size. */

export const ROW_SIGNAL_SIZE = 20;

export const RowSignalColor = {
  /** Cooler than system accent blue — more cyan, less royal. */
  unread: "#5BA8FF",
  /** Clean gold, not mustard. */
  unresponded: "#FFD056",
  unrespondedGlyph: "#2C2208",
  /** Sea-glass teal. */
  archived: "#3DCFC0",
  onFill: "#FFFFFF",
} as const;

export type RowSignalKind = "unread" | "unresponded" | "archived";

export function rowSignal(chat: {
  readonly unreadCount: number;
  readonly flags: { readonly unresponded: boolean; readonly archived: boolean };
}): RowSignalKind | null {
  if (chat.unreadCount > 0) return "unread";
  if (chat.flags.unresponded) return "unresponded";
  if (chat.flags.archived) return "archived";
  return null;
}

export function unreadLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}
