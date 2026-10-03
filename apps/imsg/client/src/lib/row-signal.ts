/** Trailing state slot on a conversation row. One slot, one size. */

export const ROW_SIGNAL_SIZE = 20;

/** Messages.app marks unread with a dot, never a count. */
export const UNREAD_DOT_SIZE = 10;

export type RowSignalKind = "unread";

export function rowSignal(chat: {
  readonly unreadCount: number;
  readonly flags: { readonly unresponded: boolean };
}): RowSignalKind | null {
  if (chat.unreadCount > 0) return "unread";
  return null;
}
