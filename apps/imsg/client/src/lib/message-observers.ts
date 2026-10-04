import type { ChatSummary, Message } from "@shared/types";

/** Observe only new inbound GUIDs once per mounted thread. */
export function createInboundReadObserver() {
  let chat: string | null = null;
  const seen = new Set<string>();
  return {
    observe(chatGuid: string, messages: readonly Message[], active: boolean): boolean {
      if (chat !== chatGuid) {
        chat = chatGuid;
        seen.clear();
      }
      const inbound = messages.filter((message) => !message.isFromMe && !message.isGroupEvent && !message.retracted);
      if (!active || inbound.length === 0) return false;
      const added = inbound.some((message) => !seen.has(message.guid));
      for (const message of inbound) seen.add(message.guid);
      return added;
    },
  };
}

/** Conversation snapshots carry the latest GUID. Old pages and replay stay silent. */
export function createReceiveSoundObserver(now = Date.now()) {
  let initialized = false;
  let liveSince = now;
  const seen = new Set<string>();
  const latestAt = new Map<string, number>();
  return {
    reconnect(now: number): void {
      // Catch-up messages predate the new live connection, even if unseen.
      liveSince = now;
    },
    observe(chats: readonly Pick<ChatSummary, "guid" | "lastMessage">[] | null, now: number, connected = true): string[] {
      if (!chats) return [];
      const received: string[] = [];
      for (const chat of chats) {
        const message = chat.lastMessage;
        if (!message) continue;
        const previousAt = latestAt.get(chat.guid) ?? -Infinity;
        // No upper bound: dates come from the Mac's clock, which may run ahead of this device.
        if (initialized && connected && !seen.has(message.guid) && !message.isFromMe &&
          message.dateCreated >= liveSince && message.dateCreated > previousAt) {
          received.push(message.guid);
        }
        seen.add(message.guid);
        latestAt.set(chat.guid, Math.max(previousAt, message.dateCreated));
      }
      initialized = true;
      return received;
    },
  };
}
