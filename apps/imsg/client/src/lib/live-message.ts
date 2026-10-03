import type { Message, ServerEvent } from "@shared/types";

/** One recent inbound stream message per chat, until its history query catches up. */
export function createLiveMessagePreview(limit = 100) {
  const latest = new Map<string, Message>();
  return {
    receive(event: ServerEvent): void {
      if (event.kind === "resync") { latest.clear(); return; }
      if (event.kind !== "new-message" && event.kind !== "updated-message") return;
      const previous = latest.get(event.chatGuid);
      if (event.message.retracted) {
        if (previous?.guid === event.message.guid) latest.delete(event.chatGuid);
        return;
      }
      if (event.message.isFromMe) return;
      if (previous && previous.dateCreated > event.message.dateCreated) return;
      latest.delete(event.chatGuid);
      latest.set(event.chatGuid, event.message);
      if (latest.size > limit) latest.delete(latest.keys().next().value!);
    },
    withHistory(chatGuid: string | null, history: readonly Message[]): Message[] {
      const message = chatGuid ? latest.get(chatGuid) : undefined;
      if (!message) return [...history];
      if (history.some((row) => row.guid === message.guid || row.dateCreated > message.dateCreated)) {
        latest.delete(chatGuid!);
        return [...history];
      }
      return [...history, message].sort((a, b) => a.dateCreated - b.dateCreated);
    },
  };
}

export const liveMessagePreview = createLiveMessagePreview();
