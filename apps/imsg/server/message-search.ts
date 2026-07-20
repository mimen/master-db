import type { BBMessage } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import { ChatDb } from "./chatdb";
import type { ContactBook } from "./contacts";
import { mapMessage } from "./map";
import type { Message } from "../shared/types";

const CORPUS_TTL_MS = 30_000;

export interface SearchOptions {
  chatGuid?: string;
  from?: "me" | "them";
}

/**
 * Full-history search backed by the local chat.db (when Full Disk Access is
 * granted); falls back to a cached window of BlueBubbles' recent messages.
 */
export class MessageSearch {
  private corpus: { at: number; messages: BBMessage[] } | null = null;
  private chatdb = new ChatDb();

  constructor(
    private bb: BlueBubbles,
    private contacts: ContactBook,
  ) {}

  async search(q: string, options: SearchOptions = {}): Promise<Message[]> {
    const needle = q.trim();
    if (needle.length < 2) return [];

    if (this.chatdb.available()) {
      return this.chatdb.search(needle, this.contacts, {
        chatGuid: options.chatGuid,
        from: options.from,
        limit: 60,
      });
    }

    // Fallback: substring over a cached recent window.
    const lower = needle.toLowerCase();
    if (!this.corpus || Date.now() - this.corpus.at > CORPUS_TTL_MS) {
      const messages: BBMessage[] = [];
      for (let offset = 0; offset < 3000; offset += 1000) {
        const batch = await this.bb.queryMessages({ limit: 1000, offset });
        if (!batch.ok) break;
        messages.push(...batch.value);
        if (batch.value.length < 1000) break;
      }
      this.corpus = { at: Date.now(), messages };
    }
    const found: BBMessage[] = [];
    for (const message of this.corpus.messages) {
      if (found.length >= 50) break;
      const chatGuid = message.chats?.[0]?.guid ?? "";
      if (options.chatGuid && chatGuid !== options.chatGuid) continue;
      if (options.from === "me" && message.isFromMe !== true) continue;
      if (options.from === "them" && message.isFromMe === true) continue;
      if ((message.text ?? "").toLowerCase().includes(lower)) found.push(message);
    }
    return found.map((m) => mapMessage(m, m.chats?.[0]?.guid ?? "", this.contacts));
  }
}
