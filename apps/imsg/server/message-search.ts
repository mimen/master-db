import type { BlueBubbles } from "./bluebubbles";
import { mapMessage } from "./map";
import type { NameSource } from "./name-resolver";
import type { Message } from "../shared/types";

export interface SearchOptions {
  chatGuid?: string;
  from?: "me" | "them";
}

export class MessageSearch {
  constructor(
    private bb: BlueBubbles,
    private contacts: NameSource,
  ) {}

  async search(q: string, options: SearchOptions = {}): Promise<Message[]> {
    const needle = q.trim();
    if (needle.length < 2) return [];
    const result = await this.bb.queryMessages({
      limit: 50,
      offset: 0,
      text: needle,
      ...options,
    });
    return result.ok
      ? result.value.map((message) => mapMessage(message, options.chatGuid ?? message.chats?.[0]?.guid ?? "", this.contacts))
      : [];
  }
}
