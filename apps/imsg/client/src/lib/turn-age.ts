import type { ChatSummary } from "@shared/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Past this, an age reads in persimmon (copy.md: "age color past 48 hours"). */
export const LATE_AFTER_MS = 2 * DAY;

/** "4m", "5h", "6d", "2w", "1y". The compact age on rows, the palette, the state strip and empty lenses. */
export function compactAge(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms < 365 * DAY) return `${Math.floor(ms / (7 * DAY))}w`;
  return `${Math.floor(ms / (365 * DAY))}y`;
}

/** Your turn for 48h or more: they wrote last and nobody settled it. A row's age turns persimmon. */
export function isLateTurn(
  chat: { readonly flags: { readonly unresponded: boolean }; readonly lastMessage: { readonly dateCreated: number } | null },
  now: number = Date.now(),
): boolean {
  return chat.flags.unresponded && chat.lastMessage !== null && now - chat.lastMessage.dateCreated >= LATE_AFTER_MS;
}

// ponytail: firstUnreadAt approximates "your turn since"; a read-but-unanswered run falls back to
// the newest message. Swap in a server-side turnSince when the triage model carries one.
function turnSince(chat: ChatSummary): number | null {
  return chat.firstUnreadAt ?? chat.lastMessage?.dateCreated ?? null;
}

export interface AgedChat {
  readonly chat: ChatSummary;
  readonly ageMs: number;
}

function oldest(chats: readonly ChatSummary[], keep: (chat: ChatSummary) => boolean, since: (chat: ChatSummary) => number | null, limit: number, now: number): AgedChat[] {
  return chats
    .filter(keep)
    .flatMap((chat) => {
      const at = since(chat);
      return at === null ? [] : [{ chat, ageMs: Math.max(0, now - at) }];
    })
    .sort((a, b) => b.ageMs - a.ageMs)
    .slice(0, limit);
}

/** Needs reply conversations that have waited longest for the owner. */
export function yourTurnLongest(chats: readonly ChatSummary[], limit: number, now: number): AgedChat[] {
  return oldest(chats, (chat) => chat.flags.unresponded, turnSince, limit, now);
}

/** Waiting conversations where the owner's own message has gone unanswered longest. */
export function waitingLongest(chats: readonly ChatSummary[], limit: number, now: number): AgedChat[] {
  return oldest(chats, (chat) => chat.flags.waiting, (chat) => chat.lastMessage?.dateCreated ?? null, limit, now);
}
