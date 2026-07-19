import type { BBAttachment, BBChat, BBContact, BBMessage, BBServerInfo } from "./bb-types";
import type { BBEvent, BlueBubbles, Result } from "./bluebubbles";

/** Chat metadata plus its message history, newest-derived lastMessage computed on read. */
export interface FakeChatSeed {
  guid: string;
  displayName?: string | null;
  participants?: Array<{ address: string }>;
  messages: BBMessage[];
}

export interface FakeSeed {
  chats: FakeChatSeed[];
  contacts?: BBContact[];
  /** Whether the fake reports the private API as available (defaults to true). */
  privateApi?: boolean;
}

/**
 * In-memory {@link BlueBubbles} adapter for tests. Serves reads over the seed,
 * records mutations, and drives the inbound event stream via {@link emit} /
 * {@link receiveMessage} — mirroring what a real BlueBubbles instance does.
 */
export class FakeBlueBubbles implements BlueBubbles {
  private readonly privateApi: boolean;
  private readonly chatMeta = new Map<string, { displayName: string | null; participants: Array<{ address: string }> }>();
  private readonly messages = new Map<string, BBMessage[]>();
  private readonly contactList: BBContact[];
  private readonly listeners = new Set<(event: BBEvent) => void>();
  private seq = 0;

  /** Per-method call counters so tests can assert the reactive path avoids rebuilds. */
  readonly calls = { queryChats: 0, queryMessages: 0, chatMessages: 0 };
  /** Chat GUIDs passed to markRead, in order. */
  readonly markReadCalls: string[] = [];
  /** Texts passed to sendText, in order. */
  readonly sentTexts: Array<{ chatGuid: string; message: string }> = [];

  constructor(seed: FakeSeed) {
    this.privateApi = seed.privateApi ?? true;
    this.contactList = seed.contacts ?? [];
    for (const chat of seed.chats) {
      this.chatMeta.set(chat.guid, {
        displayName: chat.displayName ?? null,
        participants: chat.participants ?? [],
      });
      this.messages.set(
        chat.guid,
        chat.messages.map((m) => ({ ...m, chats: [{ guid: chat.guid }] })),
      );
    }
  }

  // -------------------------------------------------------------- event stream

  onEvent(cb: (event: BBEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Fans an event out to subscribers, exactly like the real socket path. */
  emit(event: BBEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** A strictly-increasing epoch-ms-scale timestamp, newer than any prior one. */
  private nextTimestamp(): number {
    return Date.now() + ++this.seq;
  }

  /** Appends an inbound message to the seed and emits the matching new-message event. */
  receiveMessage(chatGuid: string, text: string, opts: { guid?: string; handle?: string } = {}): BBMessage {
    const message: BBMessage = {
      guid: opts.guid ?? `in-${this.seq}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      dateCreated: this.nextTimestamp(),
      isFromMe: false,
      handle: opts.handle ? { address: opts.handle } : null,
      chats: [{ guid: chatGuid }],
    };
    this.append(chatGuid, message);
    this.emit({ kind: "new-message", message });
    return message;
  }

  private append(chatGuid: string, message: BBMessage): void {
    const list = this.messages.get(chatGuid);
    if (list) list.push(message);
    else this.messages.set(chatGuid, [message]);
  }

  private lastMessageOf(chatGuid: string): BBMessage | null {
    const list = this.messages.get(chatGuid) ?? [];
    let last: BBMessage | null = null;
    for (const m of list) {
      if (!last || (m.dateCreated ?? 0) >= (last.dateCreated ?? 0)) last = m;
    }
    return last;
  }

  private allMessages(): BBMessage[] {
    const all: BBMessage[] = [];
    for (const list of this.messages.values()) all.push(...list);
    return all.sort((a, b) => (b.dateCreated ?? 0) - (a.dateCreated ?? 0));
  }

  // ---------------------------------------------------------------------- reads

  connect(): Promise<Result<BBServerInfo>> {
    return Promise.resolve({
      ok: true,
      value: { private_api: this.privateApi, server_version: "fake" },
    });
  }

  get hasPrivateApi(): boolean {
    return this.privateApi;
  }

  queryChats(): Promise<Result<BBChat[]>> {
    this.calls.queryChats++;
    const chats: BBChat[] = [...this.chatMeta.entries()].map(([guid, meta]) => ({
      guid,
      displayName: meta.displayName,
      participants: meta.participants,
      lastMessage: this.lastMessageOf(guid),
    }));
    chats.sort(
      (a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0),
    );
    return Promise.resolve({ ok: true, value: chats });
  }

  chatMessages(
    chatGuid: string,
    options: { limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC" } = {},
  ): Promise<Result<BBMessage[]>> {
    this.calls.chatMessages++;
    const sort = options.sort ?? "DESC";
    const list = [...(this.messages.get(chatGuid) ?? [])].sort((a, b) =>
      sort === "ASC"
        ? (a.dateCreated ?? 0) - (b.dateCreated ?? 0)
        : (b.dateCreated ?? 0) - (a.dateCreated ?? 0),
    );
    const windowed = list
      .filter((m) => (options.before ? (m.dateCreated ?? 0) < options.before : true))
      .filter((m) => (options.after ? (m.dateCreated ?? 0) > options.after : true))
      .slice(0, options.limit ?? 75);
    return Promise.resolve({ ok: true, value: windowed });
  }

  queryMessages(options: { limit: number; offset: number }): Promise<Result<BBMessage[]>> {
    this.calls.queryMessages++;
    const value = this.allMessages().slice(options.offset, options.offset + options.limit);
    return Promise.resolve({ ok: true, value });
  }

  contacts(): Promise<Result<BBContact[]>> {
    return Promise.resolve({ ok: true, value: this.contactList });
  }

  getChat(chatGuid: string): Promise<Result<BBChat>> {
    const meta = this.chatMeta.get(chatGuid);
    if (!meta) return Promise.resolve({ ok: false, error: "no such chat" });
    return Promise.resolve({
      ok: true,
      value: {
        guid: chatGuid,
        displayName: meta.displayName,
        participants: meta.participants,
        lastMessage: this.lastMessageOf(chatGuid),
      },
    });
  }

  // ------------------------------------------------------------------ mutations

  sendText(chatGuid: string, message: string): Promise<Result<BBMessage>> {
    this.sentTexts.push({ chatGuid, message });
    const sent: BBMessage = {
      guid: `out-${this.seq}-${Math.random().toString(36).slice(2, 8)}`,
      text: message,
      dateCreated: this.nextTimestamp(),
      isFromMe: true,
      handle: null,
      chats: [{ guid: chatGuid }],
    };
    this.append(chatGuid, sent);
    return Promise.resolve({ ok: true, value: sent });
  }

  markRead(chatGuid: string): Promise<Result<unknown>> {
    this.markReadCalls.push(chatGuid);
    return Promise.resolve({ ok: true, value: undefined });
  }

  // --------------------------------- unused interface members (empty adapters)

  sendAttachment(): Promise<Result<BBMessage>> {
    return Promise.resolve({ ok: false, error: "not implemented in fake" });
  }

  react(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  setTyping(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  unsend(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  edit(): Promise<Result<BBMessage>> {
    return Promise.resolve({ ok: false, error: "not implemented in fake" });
  }

  createChat(): Promise<Result<BBChat>> {
    return Promise.resolve({ ok: false, error: "not implemented in fake" });
  }

  attachmentMeta(): Promise<Result<BBAttachment>> {
    return Promise.resolve({ ok: false, error: "not implemented in fake" });
  }

  downloadAttachment(): Promise<Response> {
    return Promise.resolve(new Response(null, { status: 404 }));
  }
}
