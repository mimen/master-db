import { computeFlags, type ChatState } from "@shared/chat-state";
import type { ChatSummary } from "@shared/types";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * An Overlay write the user just made, shown on the Chat Directory until the directory shows it
 * too. Each is the Overlay change the bridge will make, so Chat State derives the flags the server
 * will compute. Settle carries the newest message the user saw and read its moment, so a newer
 * message stays visible. A settle right after a send has only a temp guid, so `seen` is undefined
 * and the settle holds while the newest message is still the user's own.
 */
export type FlagIntent =
  | { change: "settle"; chatGuid: string; seen: string | undefined }
  | { change: "unsettle"; chatGuid: string }
  | { change: "read"; chatGuid: string; at: number }
  | { change: "unread"; chatGuid: string }
  | { change: "pin"; chatGuid: string; value: boolean };

/** `confirmed` once the bridge has executed the command. Only a confirmed intent can retire. */
export interface PendingFlag { readonly intent: FlagIntent; readonly confirmed: boolean }

/** One pending intent per chat and axis; a newer one on the same axis replaces the older. */
export type PendingFlags = ReadonlyMap<string, PendingFlag>;

const AXIS: Record<FlagIntent["change"], string> = { settle: "triage", unsettle: "triage", read: "read", unread: "read", pin: "pin" };

function write(state: ChatState, intent: FlagIntent, last: ChatSummary["lastMessage"]): ChatState {
  switch (intent.change) {
    case "settle": return last && (intent.seen === undefined ? last.isFromMe : last.guid === intent.seen)
      ? { ...state, dismissedUnrespondedGuid: last.guid, dismissedWaitingGuid: last.guid } : state;
    case "unsettle": return { ...state, dismissedUnrespondedGuid: null, dismissedWaitingGuid: null };
    case "read": return { ...state, readAt: intent.at, markedUnread: 0 };
    case "unread": return { ...state, markedUnread: 1 };
    case "pin": return { ...state, pinned: Number(intent.value) };
  }
}

/** The Overlay a summary implies. Dismissal guids are not on the wire; a cleared flag stands for a dismissal at the last message. */
function overlayOf(chat: ChatSummary): ChatState {
  const last = chat.lastMessage;
  return {
    chatGuid: chat.guid,
    dismissedUnrespondedGuid: last && !last.isFromMe && !chat.flags.unresponded ? last.guid : null,
    dismissedWaitingGuid: last && last.isFromMe && !chat.flags.waiting ? last.guid : null,
    mutedUnresponded: 0,
    pinned: Number(chat.flags.pinned),
    markedUnread: Number(chat.flags.unread && chat.unreadCount === 0),
  };
}

function apply(chat: ChatSummary, intents: readonly FlagIntent[]): ChatSummary {
  const state = intents.reduce((current, intent) => write(current, intent, chat.lastMessage), overlayOf(chat));
  // listConversations' rule: a read at or after the last message zeroes the count.
  const unreadCount = (state.readAt ?? -1) >= (chat.lastMessage?.dateCreated ?? 0) ? 0 : chat.unreadCount;
  const flags = computeFlags(state, chat.lastMessage, unreadCount);
  const same = unreadCount === chat.unreadCount && (Object.keys(flags) as (keyof typeof flags)[]).every((key) => flags[key] === chat.flags[key]);
  // firstUnreadAt stays: the open thread still needs it to place its unread divider.
  return same ? chat : { ...chat, flags, unreadCount };
}

/** The directory as the user's pending intents leave it. Returns `chats` itself when no row changes. */
export function applyFlagIntents(chats: ChatSummary[], pending: PendingFlags): ChatSummary[] {
  if (pending.size === 0) return chats;
  const byChat = new Map<string, FlagIntent[]>();
  for (const { intent } of pending.values()) byChat.set(intent.chatGuid, [...(byChat.get(intent.chatGuid) ?? []), intent]);
  const shown = chats.map((chat) => {
    const mine = byChat.get(chat.guid);
    return mine ? apply(chat, mine) : chat;
  });
  return shown.every((chat, index) => chat === chats[index]) ? chats : shown;
}

/** Drops confirmed intents the directory already shows, or that a newer message made moot. Returns `pending` itself when none retire. */
export function retireFlagIntents(pending: PendingFlags, chats: readonly ChatSummary[]): PendingFlags {
  if (pending.size === 0) return pending;
  const byGuid = new Map(chats.map((chat) => [chat.guid, chat]));
  const done = [...pending].filter(([, { intent, confirmed }]) => {
    const chat = byGuid.get(intent.chatGuid);
    return confirmed && chat !== undefined && apply(chat, [intent]) === chat;
  });
  if (done.length === 0) return pending;
  const next = new Map(pending);
  for (const [key] of done) next.delete(key);
  return next;
}

let pending: PendingFlags = new Map();
const listeners = new Set<() => void>();

function publish(next: PendingFlags): void {
  if (next === pending) return;
  pending = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows `intent` at once. Confirm and rollback act only while no newer intent on the same axis has replaced it. */
export function pendFlags(intent: FlagIntent): { confirm(): void; rollback(): void } {
  const key = `${AXIS[intent.change]} ${intent.chatGuid}`;
  publish(new Map(pending).set(key, { intent, confirmed: false }));
  const settle = (keep: boolean) => {
    if (pending.get(key)?.intent !== intent) return;
    const next = new Map(pending);
    if (keep) next.set(key, { intent, confirmed: true });
    else next.delete(key);
    publish(next);
  };
  return { confirm: () => settle(true), rollback: () => settle(false) };
}

/** The directory with pending intents applied. Only ChatDirectoryProvider calls this. */
export function usePendingFlags(chats: ChatSummary[] | null): ChatSummary[] | null {
  const current = useSyncExternalStore(subscribe, () => pending, () => pending);
  useEffect(() => {
    if (chats) publish(retireFlagIntents(pending, chats));
  }, [chats, current]);
  return useMemo(() => chats && applyFlagIntents(chats, current), [chats, current]);
}

export function resetPendingFlagsForTests(): void {
  pending = new Map();
}
