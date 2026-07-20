import { applyMessage } from "@shared/chat-state";
import type { ChatSummary, Message } from "@shared/types";

/**
 * Module-level conversation store. Server fetches replace the list; known
 * messages (send responses, SSE payloads) patch it instantly so the sidebar
 * never waits on a round trip.
 */
let all: ChatSummary[] | null = null;
const listeners = new Set<(chats: ChatSummary[]) => void>();

function emit(): void {
  if (!all) return;
  for (const listener of listeners) listener(all);
}

export function getChats(): ChatSummary[] | null {
  return all;
}

export function subscribeChats(listener: (chats: ChatSummary[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setChats(next: ChatSummary[]): void {
  all = next;
  emit();
}

/** Instantly reflect a known message in the sidebar; the next fetch reconciles. */
export function patchChatWithMessage(chatGuid: string, message: Message): void {
  if (!all) return;
  const result = applyMessage(all, chatGuid, message);
  if (!result) return; // unknown chat: ignore client-side
  if (result === all) return; // stale message: same reference, no change
  all = result;
  emit();
}

/** Local flag tweak (e.g. clearing unread when a chat is opened). */
export function patchChatFlags(
  chatGuid: string,
  patch: Partial<ChatSummary["flags"]> & { unreadCount?: number },
): void {
  if (!all) return;
  const index = all.findIndex((c) => c.guid === chatGuid);
  const chat = index >= 0 ? all[index] : undefined;
  if (!chat) return;
  const { unreadCount, ...flags } = patch;
  const next = [...all];
  next[index] = {
    ...chat,
    unreadCount: unreadCount ?? chat.unreadCount,
    firstUnreadAt: flags.unread === false || unreadCount === 0 ? null : chat.firstUnreadAt,
    flags: { ...chat.flags, ...flags },
  };
  all = next;
  emit();
}
