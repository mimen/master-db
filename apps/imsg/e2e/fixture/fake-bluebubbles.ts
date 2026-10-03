import type {
  BBAttributedBody,
  BBAttachment,
  BBChat,
  BBContact,
  BBMessage,
  BBScheduledMessage,
  BBServerInfo,
} from "../../server/bb-types";
import { FakeBlueBubbles, type FakeSeed } from "../../server/bluebubbles-fake";
import type { BBEvent, BlueBubbles, MessageQueryOptions, Result } from "../../server/bluebubbles";

export type FaultableMethod = Exclude<keyof BlueBubbles, "hasPrivateApi" | "onEvent">;

export class FixtureBlueBubbles implements BlueBubbles {
  private fake: FakeBlueBubbles;
  private readonly listeners = new Set<(event: BBEvent) => void>();
  private faults = new Map<FaultableMethod, string>();
  private readonly clientKeys = new Map<string, string>();
  private readonly deletedMessages = new Set<string>();
  private readonly groupNames = new Map<string, string>();
  /** sendText's response latency, and whether the event stream echoes the send before it, as BlueBubbles does. */
  private sendTiming: { delayMs: number; echo: boolean } | null = null;

  constructor(seed: FakeSeed) {
    this.fake = new FakeBlueBubbles(seed);
  }

  reset(seed: FakeSeed): void {
    this.fake = new FakeBlueBubbles(seed);
    this.faults.clear();
    this.clientKeys.clear();
    this.deletedMessages.clear();
    this.groupNames.clear();
    this.sendTiming = null;
  }

  setSendTiming(timing: { delayMs: number; echo: boolean } | null): void {
    this.sendTiming = timing;
  }

  clientKeyFor(messageGuid: string): string | undefined {
    return this.clientKeys.get(messageGuid);
  }

  setFault(method: FaultableMethod | null, error = "fixture fault"): void {
    if (method === null) {
      this.faults.clear();
      return;
    }
    this.faults.set(method, error);
  }

  private failure<T>(method: FaultableMethod): Result<T> | null {
    const error = this.faults.get(method);
    return error ? { ok: false, error } : null;
  }

  private emit(event: BBEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  receiveMessage(chatGuid: string, text: string, handle?: string): BBMessage {
    const message = this.fake.receiveMessage(chatGuid, text, { handle });
    this.emit({ kind: "new-message", message });
    return message;
  }

  onEvent(callback: (event: BBEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  get hasPrivateApi(): boolean {
    return this.fake.hasPrivateApi;
  }

  connect(): Promise<Result<BBServerInfo>> {
    return Promise.resolve(this.failure<BBServerInfo>("connect") ?? this.fake.connect());
  }

  async queryChats(limit?: number): Promise<Result<BBChat[]>> {
    const result = this.failure<BBChat[]>("queryChats") ?? await this.fake.queryChats(limit);
    if (!result.ok) return result;
    return { ok: true, value: await Promise.all(result.value.map((chat) => this.chatView(chat))) };
  }

  private async chatView(chat: BBChat): Promise<BBChat> {
    const result = await this.fake.chatMessages(chat.guid, { limit: Number.MAX_SAFE_INTEGER });
    const lastMessage = result.ok ? result.value.find((message) =>
      !this.deletedMessages.has(message.guid) && !message.dateRetracted && !message.associatedMessageGuid) ?? null : chat.lastMessage;
    return { ...chat, displayName: this.groupNames.get(chat.guid) ?? chat.displayName, lastMessage };
  }

  async chatMessages(
    chatGuid: string,
    options?: { limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC" },
  ): Promise<Result<BBMessage[]>> {
    const failure = this.failure<BBMessage[]>("chatMessages");
    if (failure) return failure;
    const result = await this.fake.chatMessages(chatGuid, { ...options, limit: Number.MAX_SAFE_INTEGER });
    return result.ok ? { ok: true, value: result.value.filter((message) => !this.deletedMessages.has(message.guid)).slice(0, options?.limit ?? 75) } : result;
  }

  async queryMessages(options: MessageQueryOptions): Promise<Result<BBMessage[]>> {
    const result = this.failure<BBMessage[]>("queryMessages") ?? await this.fake.queryMessages({ ...options, offset: 0, limit: Number.MAX_SAFE_INTEGER });
    return result.ok ? { ok: true, value: result.value.filter((message) => !this.deletedMessages.has(message.guid)).slice(options.offset, options.offset + options.limit) } : result;
  }

  messageWithReactions(messageGuid: string): Promise<Result<BBMessage[]>> {
    return Promise.resolve(
      this.failure<BBMessage[]>("messageWithReactions") ?? this.fake.messageWithReactions(messageGuid),
    );
  }

  async sendText(
    chatGuid: string,
    message: string,
    replyTo?: { guid: string; part: number },
    attributedBody?: BBAttributedBody,
    clientKey?: string,
  ): Promise<Result<BBMessage>> {
    const failure = this.failure<BBMessage>("sendText");
    if (failure) return failure;
    const timing = this.sendTiming;
    if (timing && !timing.echo) await Bun.sleep(timing.delayMs);
    const sent = await this.fake.sendText(chatGuid, message, replyTo, attributedBody, clientKey);
    if (sent.ok && replyTo) sent.value.threadOriginatorGuid = replyTo.guid;
    if (sent.ok && clientKey) this.clientKeys.set(sent.value.guid, clientKey);
    if (sent.ok && timing?.echo) {
      this.emit({ kind: "new-message", message: sent.value });
      await Bun.sleep(timing.delayMs);
    }
    return sent;
  }

  sendAttachment(_chatGuid: string, _filename: string, _bytes: Uint8Array): Promise<Result<BBMessage>> {
    return Promise.resolve(
      this.failure<BBMessage>("sendAttachment") ?? this.fake.sendAttachment(),
    );
  }

  async react(chatGuid: string, messageGuid: string, reaction: string, partIndex = 0): Promise<Result<unknown>> {
    const failure = this.failure<unknown>("react");
    if (failure) return failure;
    const message: BBMessage = {
      guid: `reaction-${crypto.randomUUID()}`, chats: [{ guid: chatGuid }],
      isFromMe: true, dateCreated: Date.now(),
      associatedMessageGuid: `p:${partIndex}/${messageGuid}`, associatedMessageType: reaction,
    };
    this.fake.appendMessage(chatGuid, message);
    this.emit({ kind: "new-message", message });
    return { ok: true, value: undefined };
  }

  markRead(chatGuid: string): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("markRead") ?? this.fake.markRead(chatGuid));
  }

  setTyping(_chatGuid: string, _active: boolean): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("setTyping") ?? this.fake.setTyping());
  }

  async unsend(messageGuid: string, _partIndex?: number): Promise<Result<unknown>> {
    const failure = this.failure<unknown>("unsend");
    if (failure) return failure;
    const result = await this.fake.messageWithReactions(messageGuid);
    if (!result.ok) return result;
    result.value[0].dateRetracted = Date.now();
    this.emit({ kind: "updated-message", message: result.value[0] });
    return { ok: true, value: undefined };
  }

  async edit(messageGuid: string, editedMessage: string, _partIndex?: number): Promise<Result<BBMessage>> {
    const failure = this.failure<BBMessage>("edit");
    if (failure) return failure;
    const result = await this.fake.messageWithReactions(messageGuid);
    if (!result.ok) return result;
    const message = result.value[0];
    message.text = editedMessage;
    message.dateEdited = Date.now();
    this.emit({ kind: "updated-message", message });
    return { ok: true, value: message };
  }

  createChat(addresses: string[], message: string): Promise<Result<BBChat>> {
    return Promise.resolve(this.failure<BBChat>("createChat") ?? this.fake.createChat(addresses, message));
  }

  sendAudio(_chatGuid: string, _filename: string, _bytes: Uint8Array): Promise<Result<BBMessage>> {
    return Promise.resolve(
      this.failure<BBMessage>("sendAudio") ?? this.fake.sendAudio(),
    );
  }

  sendAttachmentWithCaption(
    _chatGuid: string,
    _filename: string,
    _bytes: Uint8Array,
    _caption?: string,
  ): Promise<Result<BBMessage>> {
    return Promise.resolve(
      this.failure<BBMessage>("sendAttachmentWithCaption")
        ?? this.fake.sendAttachmentWithCaption(),
    );
  }

  renameGroup(chatGuid: string, name: string): Promise<Result<unknown>> {
    const failure = this.failure<unknown>("renameGroup");
    if (failure) return Promise.resolve(failure);
    this.groupNames.set(chatGuid, name);
    return Promise.resolve({ ok: true, value: undefined });
  }

  addParticipant(_chatGuid: string, _address: string): Promise<Result<unknown>> {
    return Promise.resolve(
      this.failure<unknown>("addParticipant") ?? this.fake.addParticipant(),
    );
  }

  removeParticipant(_chatGuid: string, _address: string): Promise<Result<unknown>> {
    return Promise.resolve(
      this.failure<unknown>("removeParticipant") ?? this.fake.removeParticipant(),
    );
  }

  leaveGroup(_chatGuid: string): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("leaveGroup") ?? this.fake.leaveGroup());
  }

  deleteChat(_chatGuid: string): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("deleteChat") ?? this.fake.deleteChat());
  }

  async deleteMessage(chatGuid: string, messageGuid: string): Promise<Result<unknown>> {
    const failure = this.failure<unknown>("deleteMessage");
    if (failure) return failure;
    const result = await this.fake.messageWithReactions(messageGuid);
    if (!result.ok || !result.value[0].chats?.some((chat) => chat.guid === chatGuid)) return { ok: false, error: "message not found in chat" };
    this.deletedMessages.add(messageGuid);
    this.emit({ kind: "updated-message", message: { ...result.value[0], dateRetracted: Date.now() } });
    return { ok: true, value: undefined };
  }

  contacts(): Promise<Result<BBContact[]>> {
    return Promise.resolve(this.failure<BBContact[]>("contacts") ?? this.fake.contacts());
  }

  async getChat(chatGuid: string): Promise<Result<BBChat>> {
    const result = this.failure<BBChat>("getChat") ?? await this.fake.getChat(chatGuid);
    return result.ok ? { ok: true, value: await this.chatView(result.value) } : result;
  }

  attachmentMeta(guid: string): Promise<Result<BBAttachment>> {
    return Promise.resolve(this.failure<BBAttachment>("attachmentMeta") ?? this.fake.attachmentMeta(guid));
  }

  downloadAttachment(guid: string): Promise<Response> {
    const error = this.faults.get("downloadAttachment");
    return error
      ? Promise.resolve(Response.json({ error }, { status: 502 }))
      : this.fake.downloadAttachment(guid);
  }

  listScheduledMessages(): Promise<Result<BBScheduledMessage[]>> {
    return Promise.resolve(
      this.failure<BBScheduledMessage[]>("listScheduledMessages") ?? this.fake.listScheduledMessages(),
    );
  }

  createScheduledMessage(chatGuid: string, text: string, sendAt: number): Promise<Result<BBScheduledMessage>> {
    return Promise.resolve(
      this.failure<BBScheduledMessage>("createScheduledMessage")
        ?? this.fake.createScheduledMessage(chatGuid, text, sendAt),
    );
  }

  updateScheduledMessage(
    id: number,
    chatGuid: string,
    text: string,
    sendAt: number,
  ): Promise<Result<BBScheduledMessage>> {
    return Promise.resolve(
      this.failure<BBScheduledMessage>("updateScheduledMessage")
        ?? this.fake.updateScheduledMessage(id, chatGuid, text, sendAt),
    );
  }

  deleteScheduledMessage(id: number): Promise<Result<void>> {
    return Promise.resolve(
      this.failure<void>("deleteScheduledMessage") ?? this.fake.deleteScheduledMessage(id),
    );
  }

  createFaceTimeLink(): Promise<Result<string>> {
    return Promise.resolve(this.failure<string>("createFaceTimeLink") ?? this.fake.createFaceTimeLink());
  }
}
