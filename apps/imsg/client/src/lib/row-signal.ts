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

/** An age turns the turn color once it has been your move this long. */
export const LATE_AFTER_MS = 48 * 3_600_000;

/** Your turn for 48h or more: they wrote last and nobody settled it. */
export function isLateTurn(
  chat: { readonly flags: { readonly unresponded: boolean }; readonly lastMessage: { readonly dateCreated: number } | null },
  now: number = Date.now(),
): boolean {
  return chat.flags.unresponded && chat.lastMessage !== null && now - chat.lastMessage.dateCreated >= LATE_AFTER_MS;
}
