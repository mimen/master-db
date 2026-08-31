/** Trailing state disc on a conversation row. One slot, one size. */

export const ROW_SIGNAL_SIZE = 20;

export const RowSignalColor = {
  /** Cooler than system accent blue — more cyan, less royal. */
  unread: "#5BA8FF",
  onFill: "#FFFFFF",
} as const;

export type RowSignalKind = "unread";

export function rowSignal(chat: {
  readonly unreadCount: number;
  readonly flags: { readonly unresponded: boolean; readonly archived: boolean };
}): RowSignalKind | null {
  if (chat.unreadCount > 0) return "unread";
  return null;
}

export function unreadLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}
