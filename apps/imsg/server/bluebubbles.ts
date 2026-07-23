import { io, type Socket } from "socket.io-client";
import type {
  BBAttachment,
  BBChat,
  BBContact,
  BBEnvelope,
  BBMessage,
  BBServerInfo,
} from "./bb-types";

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Inbound events from BlueBubbles, normalized off the raw socket.io stream.
 * The four group-* socket events collapse into one `group-changed` because
 * every consumer treats them identically.
 */
export type BBEvent =
  | { kind: "new-message"; message: BBMessage }
  | { kind: "updated-message"; message: BBMessage }
  | { kind: "chat-read-status-changed" }
  | { kind: "typing"; chatGuid: string; display: boolean }
  | { kind: "group-changed" };

/**
 * The BlueBubbles seam: the single interface to BlueBubbles — REST operations
 * plus the inbound event stream. Two adapters implement it: the HTTP/socket.io
 * client in production and an in-memory fake in tests.
 */
export interface BlueBubbles {
  connect(): Promise<Result<BBServerInfo>>;
  readonly hasPrivateApi: boolean;
  queryChats(limit?: number): Promise<Result<BBChat[]>>;
  chatMessages(
    chatGuid: string,
    options?: { limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC" },
  ): Promise<Result<BBMessage[]>>;
  queryMessages(options: {
    limit: number;
    offset: number;
    unreadInboundOnly?: boolean;
  }): Promise<Result<BBMessage[]>>;
  sendText(
    chatGuid: string,
    message: string,
    replyTo?: { guid: string; part: number },
  ): Promise<Result<BBMessage>>;
  sendAttachment(chatGuid: string, filename: string, bytes: Uint8Array): Promise<Result<BBMessage>>;
  react(
    chatGuid: string,
    messageGuid: string,
    reaction: string,
    partIndex?: number,
  ): Promise<Result<unknown>>;
  markRead(chatGuid: string): Promise<Result<unknown>>;
  setTyping(chatGuid: string, active: boolean): Promise<Result<unknown>>;
  unsend(messageGuid: string, partIndex?: number): Promise<Result<unknown>>;
  edit(messageGuid: string, editedMessage: string, partIndex?: number): Promise<Result<BBMessage>>;
  createChat(addresses: string[], message: string): Promise<Result<BBChat>>;
  sendAudio(chatGuid: string, filename: string, bytes: Uint8Array): Promise<Result<BBMessage>>;
  sendAttachmentWithCaption(
    chatGuid: string,
    filename: string,
    bytes: Uint8Array,
    caption?: string,
  ): Promise<Result<BBMessage>>;
  renameGroup(chatGuid: string, name: string): Promise<Result<unknown>>;
  addParticipant(chatGuid: string, address: string): Promise<Result<unknown>>;
  removeParticipant(chatGuid: string, address: string): Promise<Result<unknown>>;
  leaveGroup(chatGuid: string): Promise<Result<unknown>>;
  deleteChat(chatGuid: string): Promise<Result<unknown>>;
  deleteMessage(chatGuid: string, messageGuid: string): Promise<Result<unknown>>;
  contacts(): Promise<Result<BBContact[]>>;
  getChat(chatGuid: string): Promise<Result<BBChat>>;
  attachmentMeta(guid: string): Promise<Result<BBAttachment>>;
  downloadAttachment(guid: string): Promise<Response>;
  /** Subscribe to the inbound event stream; returns an unsubscribe function. */
  onEvent(cb: (event: BBEvent) => void): () => void;
}

function tempGuid(): string {
  return `temp-${Math.random().toString(36).slice(2, 10)}`;
}

export class BlueBubblesClient implements BlueBubbles {
  private privateApi = false;
  private socket: Socket | null = null;
  private listeners = new Set<(event: BBEvent) => void>();

  constructor(
    private baseUrl: string,
    private password: string,
  ) {}

  onEvent(cb: (event: BBEvent) => void): () => void {
    this.listeners.add(cb);
    // The socket.io connection is established lazily on the first subscription
    // and shared across all subscribers.
    if (!this.socket) this.startEvents();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(event: BBEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Opens the socket.io connection and translates raw events into BBEvent. */
  private startEvents(): void {
    const socket = io(this.baseUrl, {
      query: { guid: this.password, password: this.password },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelayMax: 30_000,
    });
    this.socket = socket;
    socket.on("connect", () => console.log("socket.io connected to BlueBubbles"));
    socket.on("connect_error", (err: Error) => console.error("socket.io error:", err.message));
    socket.on("new-message", (payload: BBMessage) => this.emit({ kind: "new-message", message: payload }));
    socket.on("updated-message", (payload: BBMessage) =>
      this.emit({ kind: "updated-message", message: payload }),
    );
    socket.on("chat-read-status-changed", () => this.emit({ kind: "chat-read-status-changed" }));
    socket.on("typing-indicator", (payload: { display: boolean; guid: string }) =>
      this.emit({ kind: "typing", chatGuid: payload.guid, display: payload.display }),
    );
    for (const event of ["group-name-change", "participant-added", "participant-removed", "participant-left"]) {
      socket.on(event, () => this.emit({ kind: "group-changed" }));
    }
  }

  /** Chat GUIDs contain ";" and must NOT be URL-encoded in paths (server 404s otherwise). */
  private url(path: string, params: Record<string, string> = {}): string {
    const qs = new URLSearchParams({ password: this.password, ...params });
    return `${this.baseUrl}${path}?${qs.toString()}`;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<Result<T>> {
    return this.unwrap<T>(await fetch(this.url(path, params)));
  }

  private async post<T>(path: string, body: unknown): Promise<Result<T>> {
    const res = await fetch(this.url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === null ? undefined : JSON.stringify(body),
    });
    return this.unwrap<T>(res);
  }

  private async put<T>(path: string, body: unknown): Promise<Result<T>> {
    const res = await fetch(this.url(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.unwrap<T>(res);
  }

  private async unwrap<T>(res: Response): Promise<Result<T>> {
    let envelope: BBEnvelope<T>;
    try {
      envelope = (await res.json()) as BBEnvelope<T>;
    } catch {
      return { ok: false, error: `non-JSON response (${res.status})` };
    }
    if (envelope.status !== 200) {
      const detail =
        typeof envelope.error === "object" && envelope.error !== null
          ? JSON.stringify(envelope.error)
          : String(envelope.error ?? envelope.message);
      return { ok: false, error: `${envelope.status}: ${detail}` };
    }
    return { ok: true, value: envelope.data as T };
  }

  async connect(): Promise<Result<BBServerInfo>> {
    const info = await this.get<BBServerInfo>("/api/v1/server/info");
    if (info.ok) this.privateApi = info.value.private_api === true;
    return info;
  }

  get hasPrivateApi(): boolean {
    return this.privateApi;
  }

  private sendMethod(): string {
    return this.privateApi ? "private-api" : "apple-script";
  }

  queryChats(limit = 1000): Promise<Result<BBChat[]>> {
    return this.post<BBChat[]>("/api/v1/chat/query", {
      limit,
      offset: 0,
      with: ["lastMessage", "sms"],
      sort: "lastmessage",
    });
  }

  chatMessages(
    chatGuid: string,
    options: { limit?: number; before?: number; after?: number; sort?: "ASC" | "DESC" } = {},
  ): Promise<Result<BBMessage[]>> {
    const params: Record<string, string> = {
      limit: String(options.limit ?? 75),
      offset: "0",
      sort: options.sort ?? "DESC",
      with: "attachment,handle,message.attributedBody",
    };
    if (options.before) params.before = String(options.before);
    if (options.after) params.after = String(options.after);
    return this.get<BBMessage[]>(`/api/v1/chat/${chatGuid}/message`, params);
  }

  queryMessages(options: {
    limit: number;
    offset: number;
    unreadInboundOnly?: boolean;
  }): Promise<Result<BBMessage[]>> {
    return this.post<BBMessage[]>("/api/v1/message/query", {
      limit: options.limit,
      offset: options.offset,
      sort: "DESC",
      with: ["chat", "handle", "message.attributedBody"],
      ...(options.unreadInboundOnly
        ? {
            where: [
              { statement: "message.isFromMe = :isFromMe", args: { isFromMe: 0 } },
              { statement: "message.dateRead IS NULL", args: {} },
            ],
          }
        : {}),
    });
  }

  sendText(
    chatGuid: string,
    message: string,
    replyTo?: { guid: string; part: number },
  ): Promise<Result<BBMessage>> {
    return this.post<BBMessage>("/api/v1/message/text", {
      chatGuid,
      tempGuid: tempGuid(),
      method: this.sendMethod(),
      message,
      selectedMessageGuid: replyTo?.guid,
      partIndex: replyTo?.part ?? 0,
    });
  }

  async sendAttachment(
    chatGuid: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<Result<BBMessage>> {
    const form = new FormData();
    form.append("chatGuid", chatGuid);
    form.append("tempGuid", tempGuid());
    form.append("name", filename);
    form.append("method", this.sendMethod());
    form.append("isAudioMessage", "false");
    form.append("attachment", new Blob([bytes.slice().buffer]), filename);
    const res = await fetch(this.url("/api/v1/message/attachment"), {
      method: "POST",
      body: form,
    });
    return this.unwrap<BBMessage>(res);
  }

  /** reaction: love|like|dislike|laugh|emphasize|question, "-"-prefixed to remove. Private API only. */
  react(chatGuid: string, messageGuid: string, reaction: string, partIndex = 0): Promise<Result<unknown>> {
    return this.post("/api/v1/message/react", {
      chatGuid,
      reaction,
      selectedMessageGuid: messageGuid,
      partIndex,
    });
  }

  /** Private API only. */
  markRead(chatGuid: string): Promise<Result<unknown>> {
    return this.post(`/api/v1/chat/${chatGuid}/read`, null);
  }

  /** Private API only. Shows/hides the typing indicator on the recipient's side. */
  setTyping(chatGuid: string, active: boolean): Promise<Result<unknown>> {
    if (active) return this.post(`/api/v1/chat/${chatGuid}/typing`, null);
    return fetch(this.url(`/api/v1/chat/${chatGuid}/typing`), { method: "DELETE" }).then((res) =>
      this.unwrap(res),
    );
  }

  /** Private API only. Apple allows unsend within ~2 minutes. */
  unsend(messageGuid: string, partIndex = 0): Promise<Result<unknown>> {
    return this.post(`/api/v1/message/${messageGuid}/unsend`, { partIndex });
  }

  /** Private API only. Apple allows edits within ~15 minutes. */
  edit(messageGuid: string, editedMessage: string, partIndex = 0): Promise<Result<BBMessage>> {
    return this.post<BBMessage>(`/api/v1/message/${messageGuid}/edit`, {
      editedMessage,
      backwardsCompatibilityMessage: `Edited: ${editedMessage}`,
      partIndex,
    });
  }

  createChat(addresses: string[], message: string): Promise<Result<BBChat>> {
    return this.post<BBChat>("/api/v1/chat/new", {
      addresses,
      message,
      method: "apple-script",
      service: "iMessage",
    });
  }

  private async sendAttachmentForm(
    chatGuid: string,
    filename: string,
    bytes: Uint8Array,
    extra: Record<string, string> = {},
  ): Promise<Result<BBMessage>> {
    const form = new FormData();
    form.append("chatGuid", chatGuid);
    form.append("tempGuid", tempGuid());
    form.append("name", filename);
    form.append("method", this.sendMethod());
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    form.append("attachment", new Blob([bytes.slice().buffer]), filename);
    const res = await fetch(this.url("/api/v1/message/attachment"), { method: "POST", body: form });
    return this.unwrap<BBMessage>(res);
  }

  sendAudio(chatGuid: string, filename: string, bytes: Uint8Array): Promise<Result<BBMessage>> {
    return this.sendAttachmentForm(chatGuid, filename, bytes, { isAudioMessage: "true" });
  }

  async sendAttachmentWithCaption(
    chatGuid: string,
    filename: string,
    bytes: Uint8Array,
    caption?: string,
  ): Promise<Result<BBMessage>> {
    // On the private API a caption rides as the subject; otherwise send it as a
    // follow-up text so the recipient still gets it.
    const extra: Record<string, string> = caption && this.hasPrivateApi ? { subject: caption } : {};
    const result = await this.sendAttachmentForm(chatGuid, filename, bytes, extra);
    if (result.ok && caption && !this.hasPrivateApi) {
      await this.sendText(chatGuid, caption);
    }
    return result;
  }

  /** Group management — all private API only. */
  renameGroup(chatGuid: string, name: string): Promise<Result<unknown>> {
    return this.put(`/api/v1/chat/${chatGuid}`, { displayName: name });
  }

  addParticipant(chatGuid: string, address: string): Promise<Result<unknown>> {
    return this.post(`/api/v1/chat/${chatGuid}/participant/add`, { address });
  }

  removeParticipant(chatGuid: string, address: string): Promise<Result<unknown>> {
    return this.post(`/api/v1/chat/${chatGuid}/participant/remove`, { address });
  }

  leaveGroup(chatGuid: string): Promise<Result<unknown>> {
    return this.post(`/api/v1/chat/${chatGuid}/leave`, null);
  }

  async deleteChat(chatGuid: string): Promise<Result<unknown>> {
    const res = await fetch(this.url(`/api/v1/chat/${chatGuid}`), { method: "DELETE" });
    return this.unwrap(res);
  }

  /** Private API. Removes the message locally ("Remove for you"), not for others. */
  async deleteMessage(chatGuid: string, messageGuid: string): Promise<Result<unknown>> {
    const res = await fetch(this.url(`/api/v1/chat/${chatGuid}/${messageGuid}`), { method: "DELETE" });
    return this.unwrap(res);
  }

  contacts(): Promise<Result<BBContact[]>> {
    return this.get<BBContact[]>("/api/v1/contact", { extraProperties: "avatar" });
  }

  getChat(chatGuid: string): Promise<Result<BBChat>> {
    return this.get<BBChat>(`/api/v1/chat/${chatGuid}`, { with: "participants" });
  }

  attachmentMeta(guid: string): Promise<Result<BBAttachment>> {
    return this.get<BBAttachment>(`/api/v1/attachment/${guid}`);
  }

  async downloadAttachment(guid: string): Promise<Response> {
    return fetch(this.url(`/api/v1/attachment/${guid}/download`));
  }
}
