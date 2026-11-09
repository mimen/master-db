import type { ChatSummary, ConversationId, Message } from "@shared/types";

/**
 * Observe new inbound GUIDs once per mounted thread. Opening the thread reads it, so the first page adds nothing, and
 * neither does a fetch filling in messages older than the newest seen: only an arrival after it does.
 */
export function createInboundReadObserver() {
  let chat: ConversationId | null = null;
  let newestSeen = -Infinity;
  const seen = new Set<string>();
  return {
    observe(conversationId: ConversationId, messages: readonly Message[], active: boolean): boolean {
      if (chat !== conversationId) {
        chat = conversationId;
        newestSeen = -Infinity;
        seen.clear();
      }
      const inbound = messages.filter((message) => !message.isFromMe && !message.isGroupEvent && !message.retracted);
      if (!active || inbound.length === 0) return false;
      const first = seen.size === 0;
      const added = !first && inbound.some((message) => !seen.has(message.guid) && message.dateCreated >= newestSeen);
      for (const message of inbound) {
        seen.add(message.guid);
        newestSeen = Math.max(newestSeen, message.dateCreated);
      }
      return added;
    },
  };
}

/** Conversation snapshots carry the latest GUID. Old pages and replay stay silent. */
export function createReceiveSoundObserver(now = Date.now()) {
  let initialized = false;
  let liveSince = now;
  const seen = new Set<string>();
  const latestAt = new Map<ConversationId, number>();
  return {
    reconnect(now: number): void {
      // Catch-up messages predate the new live connection, even if unseen.
      liveSince = now;
    },
    observe(chats: readonly Pick<ChatSummary, "conversationId" | "lastMessage">[] | null, now: number, connected = true): string[] {
      if (!chats) return [];
      const received: string[] = [];
      for (const chat of chats) {
        const message = chat.lastMessage;
        if (!message) continue;
        const previousAt = latestAt.get(chat.conversationId) ?? -Infinity;
        // No upper bound: dates come from the Mac's clock, which may run ahead of this device.
        if (initialized && connected && !seen.has(message.guid) && !message.isFromMe &&
          message.dateCreated >= liveSince && message.dateCreated > previousAt) {
          received.push(message.guid);
        }
        seen.add(message.guid);
        latestAt.set(chat.conversationId, Math.max(previousAt, message.dateCreated));
      }
      initialized = true;
      return received;
    },
  };
}
