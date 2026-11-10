import { isLateTurn } from "@/lib/turn-age";

/** Trailing state slot on a conversation row. One slot, one size. */

export const ROW_SIGNAL_SIZE = 20;

/** Messages.app marks unread with a dot, never a count. */
export const UNREAD_DOT_SIZE = 10;

/** How a row shows unread: the dot, or a semibold name in a lens that already means unread or attention. */
export type RowSignalKind = "dot" | "bold";

/** One urgency mark per row: a late turn already colours the time, so it gets no dot as well. */
export function rowSignal(
  chat: {
    readonly unreadCount: number;
    readonly flags: { readonly unresponded: boolean };
    readonly lastMessage: { readonly dateCreated: number } | null;
  },
  { boldUnread = false, now = Date.now() }: { readonly boldUnread?: boolean; readonly now?: number } = {},
): RowSignalKind | null {
  if (chat.unreadCount === 0) return null;
  if (boldUnread) return "bold";
  return isLateTurn(chat, now) ? null : "dot";
}
