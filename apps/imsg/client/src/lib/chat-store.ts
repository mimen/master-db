import type { ChatSummary, Message } from "./types";

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
  const index = all.findIndex((c) => c.guid === chatGuid);
  if (index < 0) return;
  const chat = all[index];
  if (!chat) return;
  if ((chat.lastMessage?.dateCreated ?? 0) > message.dateCreated) return;
  const updated: ChatSummary = {
    ...chat,
    lastMessage: {
      guid: message.guid,
      text: message.text || (message.attachments.length > 0 ? "Attachment" : ""),
      dateCreated: message.dateCreated,
      isFromMe: message.isFromMe,
      senderName: message.sender?.name ?? message.sender?.address ?? null,
      hasAttachments: message.attachments.length > 0,
    },
    flags: {
      ...chat.flags,
      // Sending clears "unresponded" and starts "waiting"; inbound the reverse.
      unresponded: message.isFromMe ? false : !chat.flags.mutedUnresponded,
      waiting: message.isFromMe,
      unread: message.isFromMe ? chat.flags.unread : true,
      // New inbound resurrects archived chats (mirrors server auto-unarchive).
      archived: message.isFromMe ? chat.flags.archived : false,
    },
  };
  const next = [...all];
  next.splice(index, 1);
  next.unshift(updated);
  all = next;
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
    flags: { ...chat.flags, ...flags },
  };
  all = next;
  emit();
}
