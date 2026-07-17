import type {
  BBAttachment,
  BBChat,
  BBContact,
  BBEnvelope,
  BBMessage,
  BBServerInfo,
} from "./bb-types";

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

function tempGuid(): string {
  return `temp-${Math.random().toString(36).slice(2, 10)}`;
}

export class BlueBubblesClient {
  private privateApi = false;

  constructor(
    private baseUrl: string,
    private password: string,
  ) {}

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

  queryMessages(options: { limit: number; offset: number }): Promise<Result<BBMessage[]>> {
    return this.post<BBMessage[]>("/api/v1/message/query", {
      limit: options.limit,
      offset: options.offset,
      sort: "DESC",
      with: ["chat", "handle", "message.attributedBody"],
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
