import type {
  BBAttributedBody,
  BBAttachment,
  BBChat,
  BBContact,
  BBMessage,
  BBScheduledMessage,
  BBServerInfo,
} from "./bb-types";
import type { BBEvent, BlueBubbles, Result } from "./bluebubbles";

/** Chat metadata plus its message history, newest-derived lastMessage computed on read. */
export interface FakeChatSeed {
  guid: string;
  displayName?: string | null;
  participants?: BBChat["participants"];
  messages: BBMessage[];
}

export interface FakeSeed {
  chats: FakeChatSeed[];
  contacts?: BBContact[];
  /** Whether the fake reports the private API as available (defaults to true). */
  privateApi?: boolean;
  scheduledMessages?: BBScheduledMessage[];
  faceTimeLink?: string;
  attachments?: Record<string, { meta: BBAttachment; bytes: Uint8Array; status?: number }>;
}

/**
 * In-memory {@link BlueBubbles} adapter for tests. Serves reads over the seed,
 * records mutations, and drives the inbound event stream via {@link emit} /
 * {@link receiveMessage} — mirroring what a real BlueBubbles instance does.
 */
export class FakeBlueBubbles implements BlueBubbles {
  private readonly privateApi: boolean;
  private readonly chatMeta = new Map<
    string,
    { displayName: string | null; participants: NonNullable<BBChat["participants"]> }
  >();
  private readonly messages = new Map<string, BBMessage[]>();
  private readonly contactList: BBContact[];
  private readonly scheduled = new Map<number, BBScheduledMessage>();
  private readonly faceTimeLink: string;
  private readonly attachmentFiles: Record<string, { meta: BBAttachment; bytes: Uint8Array; status?: number }>;
  private readonly listeners = new Set<(event: BBEvent) => void>();
  private seq = 0;

  /** Per-method call counters so tests can assert the reactive path avoids rebuilds. */
  readonly calls = { queryChats: 0, queryMessages: 0, chatMessages: 0, messageWithReactions: 0 };
  /** Chat GUIDs passed to markRead, in order. */
  readonly markReadCalls: string[] = [];
  /** Texts passed to sendText, in order. */
  readonly sentTexts: Array<{ chatGuid: string; message: string }> = [];
  readonly sentAttributedBodies: Array<{ chatGuid: string; attributedBody: BBAttributedBody }> = [];
  readonly scheduledCreates: Array<{ chatGuid: string; text: string; sendAt: number }> = [];
  readonly scheduledUpdates: Array<{ id: number; chatGuid: string; text: string; sendAt: number }> = [];
  readonly scheduledDeletes: number[] = [];
  faceTimeLinkCalls = 0;

  constructor(seed: FakeSeed) {
    this.privateApi = seed.privateApi ?? true;
    this.contactList = seed.contacts ?? [];
    this.faceTimeLink = seed.faceTimeLink ?? "https://facetime.apple.com/join#fake";
    this.attachmentFiles = seed.attachments ?? {};
    for (const scheduled of seed.scheduledMessages ?? []) this.scheduled.set(scheduled.id, { ...scheduled });
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

  queryMessages(options: {
    limit: number;
    offset: number;
    unreadInboundOnly?: boolean;
  }): Promise<Result<BBMessage[]>> {
    this.calls.queryMessages++;
    const messages = options.unreadInboundOnly
      ? this.allMessages().filter((message) => message.isFromMe !== true && !message.dateRead)
      : this.allMessages();
    const value = messages.slice(options.offset, options.offset + options.limit);
    return Promise.resolve({ ok: true, value });
  }

  messageWithReactions(messageGuid: string): Promise<Result<BBMessage[]>> {
    this.calls.messageWithReactions++;
    const messages = this.allMessages();
    const target = messages.find((message) => message.guid === messageGuid);
    if (!target) return Promise.resolve({ ok: false, error: "no such message" });
    const reactions = messages.filter((message) => {
      const associated = message.associatedMessageGuid?.replace(/^b?p:\d+\//, "");
      return associated === messageGuid && Boolean(message.associatedMessageType);
    });
    return Promise.resolve({ ok: true, value: [target, ...reactions] });
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

  sendText(
    chatGuid: string,
    message: string,
    _replyTo?: { guid: string; part: number },
    attributedBody?: BBAttributedBody,
  ): Promise<Result<BBMessage>> {
    this.sentTexts.push({ chatGuid, message });
    if (attributedBody) {
      this.sentAttributedBodies.push({ chatGuid, attributedBody });
    }
    const sent: BBMessage = {
      guid: `out-${this.seq}-${Math.random().toString(36).slice(2, 8)}`,
      text: message,
      dateCreated: this.nextTimestamp(),
      isFromMe: true,
      handle: null,
      chats: [{ guid: chatGuid }],
      attributedBody: attributedBody ?? null,
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

  async createChat(addresses: string[], message: string): Promise<Result<BBChat>> {
    if (addresses.length === 0) return { ok: false, error: "no addresses" };
    const guid =
      addresses.length === 1
        ? `iMessage;-;${addresses[0]}`
        : `iMessage;+;fake-group-${++this.seq}`;
    const participants = addresses.map((address) => ({ address, service: "iMessage" }));
    this.chatMeta.set(guid, { displayName: null, participants });
    const sent = await this.sendText(guid, message);
    if (!sent.ok) return sent;
    return {
      ok: true,
      value: { guid, participants, lastMessage: sent.value },
    };
  }

  sendAudio(): Promise<Result<BBMessage>> {
    return Promise.resolve({ ok: false, error: "not implemented in fake" });
  }

  sendAttachmentWithCaption(): Promise<Result<BBMessage>> {
    return Promise.resolve({ ok: false, error: "not implemented in fake" });
  }

  renameGroup(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  addParticipant(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  removeParticipant(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  leaveGroup(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  deleteMessage(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: {} });
  }

  deleteChat(): Promise<Result<unknown>> {
    return Promise.resolve({ ok: true, value: undefined });
  }

  attachmentMeta(guid: string): Promise<Result<BBAttachment>> {
    const attachment = this.attachmentFiles[guid];
    return Promise.resolve(
      attachment ? { ok: true, value: attachment.meta } : { ok: false, error: "no such attachment" },
    );
  }

  downloadAttachment(guid: string): Promise<Response> {
    const attachment = this.attachmentFiles[guid];
    if (!attachment) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(
      new Response(attachment.bytes.slice(), { status: attachment.status ?? 200 }),
    );
  }

  listScheduledMessages(): Promise<Result<BBScheduledMessage[]>> {
    return Promise.resolve({
      ok: true,
      value: [...this.scheduled.values()].sort((a, b) => Number(a.id) - Number(b.id)),
    });
  }

  createScheduledMessage(
    chatGuid: string,
    text: string,
    sendAt: number,
  ): Promise<Result<BBScheduledMessage>> {
    this.scheduledCreates.push({ chatGuid, text, sendAt });
    const id = Math.max(0, ...this.scheduled.keys()) + 1;
    const value: BBScheduledMessage = {
      id,
      type: "send-message",
      payload: { chatGuid, message: text, method: this.privateApi ? "private-api" : "apple-script" },
      scheduledFor: sendAt,
      schedule: { type: "once" },
      status: "pending",
      error: null,
      sentAt: null,
    };
    this.scheduled.set(id, value);
    return Promise.resolve({ ok: true, value });
  }

  updateScheduledMessage(
    id: number,
    chatGuid: string,
    text: string,
    sendAt: number,
  ): Promise<Result<BBScheduledMessage>> {
    this.scheduledUpdates.push({ id, chatGuid, text, sendAt });
    const existing = this.scheduled.get(id);
    if (!existing) return Promise.resolve({ ok: false, error: "no such schedule" });
    const value: BBScheduledMessage = {
      ...existing,
      payload: { ...existing.payload, chatGuid, message: text },
      scheduledFor: sendAt,
      status: "pending",
      error: null,
    };
    this.scheduled.set(id, value);
    return Promise.resolve({ ok: true, value });
  }

  deleteScheduledMessage(id: number): Promise<Result<void>> {
    this.scheduledDeletes.push(id);
    if (!this.scheduled.delete(id)) return Promise.resolve({ ok: false, error: "no such schedule" });
    return Promise.resolve({ ok: true, value: undefined });
  }

  createFaceTimeLink(): Promise<Result<string>> {
    this.faceTimeLinkCalls++;
    return Promise.resolve({ ok: true, value: this.faceTimeLink });
  }
}
