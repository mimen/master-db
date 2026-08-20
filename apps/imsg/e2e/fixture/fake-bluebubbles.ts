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
import type { BBEvent, BlueBubbles, Result } from "../../server/bluebubbles";

export type FaultableMethod = Exclude<keyof BlueBubbles, "hasPrivateApi" | "onEvent">;

export class FixtureBlueBubbles implements BlueBubbles {
  private fake: FakeBlueBubbles;
  private readonly listeners = new Set<(event: BBEvent) => void>();
  private faults = new Map<FaultableMethod, string>();

  constructor(seed: FakeSeed) {
    this.fake = new FakeBlueBubbles(seed);
  }

  reset(seed: FakeSeed): void {
    this.fake = new FakeBlueBubbles(seed);
    this.faults.clear();
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

  queryChats(_limit?: number): Promise<Result<BBChat[]>> {
    return Promise.resolve(this.failure<BBChat[]>("queryChats") ?? this.fake.queryChats());
  }

  chatMessages(
    chatGuid: string,
    options?: { limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC" },
  ): Promise<Result<BBMessage[]>> {
    return Promise.resolve(
      this.failure<BBMessage[]>("chatMessages") ?? this.fake.chatMessages(chatGuid, options),
    );
  }

  queryMessages(options: {
    limit: number;
    offset: number;
    unreadInboundOnly?: boolean;
  }): Promise<Result<BBMessage[]>> {
    return Promise.resolve(this.failure<BBMessage[]>("queryMessages") ?? this.fake.queryMessages(options));
  }

  messageWithReactions(messageGuid: string): Promise<Result<BBMessage[]>> {
    return Promise.resolve(
      this.failure<BBMessage[]>("messageWithReactions") ?? this.fake.messageWithReactions(messageGuid),
    );
  }

  sendText(
    chatGuid: string,
    message: string,
    replyTo?: { guid: string; part: number },
    attributedBody?: BBAttributedBody,
  ): Promise<Result<BBMessage>> {
    return Promise.resolve(
      this.failure<BBMessage>("sendText") ?? this.fake.sendText(chatGuid, message, replyTo, attributedBody),
    );
  }

  sendAttachment(_chatGuid: string, _filename: string, _bytes: Uint8Array): Promise<Result<BBMessage>> {
    return Promise.resolve(
      this.failure<BBMessage>("sendAttachment") ?? this.fake.sendAttachment(),
    );
  }

  react(_chatGuid: string, _messageGuid: string, _reaction: string, _partIndex?: number): Promise<Result<unknown>> {
    return Promise.resolve(
      this.failure<unknown>("react") ?? this.fake.react(),
    );
  }

  markRead(chatGuid: string): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("markRead") ?? this.fake.markRead(chatGuid));
  }

  setTyping(_chatGuid: string, _active: boolean): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("setTyping") ?? this.fake.setTyping());
  }

  unsend(_messageGuid: string, _partIndex?: number): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("unsend") ?? this.fake.unsend());
  }

  edit(_messageGuid: string, _editedMessage: string, _partIndex?: number): Promise<Result<BBMessage>> {
    return Promise.resolve(
      this.failure<BBMessage>("edit") ?? this.fake.edit(),
    );
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

  renameGroup(_chatGuid: string, _name: string): Promise<Result<unknown>> {
    return Promise.resolve(this.failure<unknown>("renameGroup") ?? this.fake.renameGroup());
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

  deleteMessage(_chatGuid: string, _messageGuid: string): Promise<Result<unknown>> {
    return Promise.resolve(
      this.failure<unknown>("deleteMessage") ?? this.fake.deleteMessage(),
    );
  }

  contacts(): Promise<Result<BBContact[]>> {
    return Promise.resolve(this.failure<BBContact[]>("contacts") ?? this.fake.contacts());
  }

  getChat(chatGuid: string): Promise<Result<BBChat>> {
    return Promise.resolve(this.failure<BBChat>("getChat") ?? this.fake.getChat(chatGuid));
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
