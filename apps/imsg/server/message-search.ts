import type { BBMessage } from "./bb-types";
import type { BlueBubblesClient } from "./bluebubbles";
import type { ContactBook } from "./contacts";
import { mapMessage } from "./map";
import type { Message } from "../shared/types";

const CORPUS_TTL_MS = 30_000;

/** Substring search over a cached window of recent messages. */
export class MessageSearch {
  private corpus: { at: number; messages: BBMessage[] } | null = null;

  constructor(
    private bb: BlueBubblesClient,
    private contacts: ContactBook,
  ) {}

  async search(q: string): Promise<Message[]> {
    const needle = q.toLowerCase();
    if (needle.length < 2) return [];
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
      if ((message.text ?? "").toLowerCase().includes(needle)) found.push(message);
    }
    return found.slice(0, 50).map((m) => mapMessage(m, m.chats?.[0]?.guid ?? "", this.contacts));
  }
}
