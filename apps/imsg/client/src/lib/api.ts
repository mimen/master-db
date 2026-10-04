import { BASE_URL } from "./config";
import { messageToMessage } from "./convex-adapters";
import { commaApi, commaOutbox } from "./convex-api";
import { enqueueVia, runCommand, type CommandClient, type CommandPayload } from "./convex-commands";
import { convexClient } from "./identity";
import { mediaApi, storedAttachmentUrl, storedAttachmentThumbnailUrl, type GalleryAttachment } from "./media-api";
import type {
  AttachmentSummary,
  AiStatus,
  Contact,
  ContactSuggestion,
  Message,
  ReplySuggestions,
  ScheduledMessage,
  SendTextRequest,
  SuggestionFeedbackRequest,
  SuggestionModel,
  TranscriptState,
} from "@shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

const messageBatches = new Set<readonly Pick<Message, "guid" | "chatGuid">[]>();

// Edit and unsend take only a message guid; mounted threads supply its chat.
export function registerMessageActions(messages: readonly Pick<Message, "guid" | "chatGuid">[]): () => void {
  messageBatches.add(messages);
  return () => { messageBatches.delete(messages); };
}

function messageChatGuid(messageGuid: string): string | undefined {
  for (const messages of messageBatches) {
    const message = messages.find((item) => item.guid === messageGuid);
    if (message) return message.chatGuid;
  }
  return undefined;
}

export async function enqueueCommand(chatGuid: string, payload: CommandPayload): Promise<{ ok: boolean }> {
  await enqueueVia(convexClient as unknown as CommandClient, chatGuid, payload);
  return { ok: true };
}

export const api = {
  messages(
    chatGuid: string,
    window?: { before?: number; after?: number; around?: number },
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (window?.before) params.set("before", String(window.before));
    if (window?.after) params.set("after", String(window.after));
    if (window?.around) params.set("around", String(window.around));
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/messages${qs}`);
  },
  async enqueueTextSend(chatGuid: string, clientKey: string, body: SendTextRequest): Promise<boolean> {
    if (body.mentions?.length) return false;
    const conversation = await convexClient.query(commaApi.resolveChat, { chatGuid });
    if (!conversation) throw new Error("Conversation is not mirrored yet");
    await convexClient.mutation(commaOutbox.enqueue, {
      clientKey,
      conversationId: conversation._id,
      payload: { kind: "send", text: body.text, ...(body.replyToGuid ? { replyToGuid: body.replyToGuid } : {}) },
    });
    return true;
  },
  sendText(
    chatGuid: string,
    body: SendTextRequest,
  ): Promise<Message> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/send`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  async markRead(chatGuid: string): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, { kind: "markRead" });
  },
  async markUnread(chatGuid: string): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, { kind: "markUnread" });
  },
  async dismiss(
    chatGuid: string,
    _kind: "unresponded" | "waiting",
    expectedLatestMessageGuid?: string,
  ): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, {
      kind: "settle",
      ...(expectedLatestMessageGuid !== undefined ? { messageGuid: expectedLatestMessageGuid } : {}),
    });
  },
  async undismiss(chatGuid: string, _kind: "unresponded" | "waiting"): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, { kind: "unsettle" });
  },
  async setPinned(chatGuid: string, pinned: boolean): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, { kind: "pin", value: pinned });
  },
  async react(
    messageGuid: string,
    body: { chatGuid: string; reaction: string; remove?: boolean; partIndex?: number; suggested?: boolean },
  ): Promise<{ ok: boolean }> {
    // Suggested reactions need the REST handler's inbound-target guard.
    if (!body.suggested) return enqueueCommand(body.chatGuid, {
      kind: "react", messageGuid, reaction: body.reaction, remove: body.remove ?? false,
      ...(body.partIndex !== undefined ? { partIndex: body.partIndex } : {}),
    });
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/react`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  async unsend(messageGuid: string): Promise<{ ok: boolean }> {
    const chatGuid = messageChatGuid(messageGuid);
    if (!chatGuid) throw new Error("Message conversation is unavailable");
    return enqueueCommand(chatGuid, { kind: "unsend", messageGuid });
  },
  async deleteMessage(messageGuid: string, chatGuid: string): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, { kind: "delete", messageGuid });
  },
  async edit(messageGuid: string, text: string): Promise<{ ok: boolean }> {
    const chatGuid = messageChatGuid(messageGuid);
    if (!chatGuid) throw new Error("Message conversation is unavailable");
    return enqueueCommand(chatGuid, { kind: "edit", messageGuid, text });
  },
  contacts(q: string): Promise<Contact[]> {
    return request(`/api/contacts?q=${encodeURIComponent(q)}`);
  },
  sendContactCard(chatGuid: string, contact: Contact, caption?: string): Promise<Message> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: contact.name, address: contact.address, caption }),
    });
  },
  findChat(address: string): Promise<{ chatGuid: string }> {
    return request(`/api/chats/find?address=${encodeURIComponent(address)}`);
  },
  newChat(body: { addresses: string[]; text: string }): Promise<{ chatGuid: string }> {
    return request("/api/chats/new", { method: "POST", body: JSON.stringify(body) });
  },
  async search(q: string, opts: { chat?: string; from?: "me" | "them" } = {}): Promise<Message[]> {
    // The Convex index filters by conversation, not sender, so "from" searches stay on REST.
    if (!opts.from) {
      const conversation = opts.chat ? await convexClient.query(commaApi.resolveChat, { chatGuid: opts.chat }) : null;
      if (opts.chat && !conversation) return [];
      {
        const rows = await convexClient.query(commaApi.searchMessages, {
          query: q,
          ...(conversation ? { conversationId: conversation._id } : {}),
        });
        return rows.map(messageToMessage);
      }
    }
    const params = new URLSearchParams({ q });
    if (opts.chat) params.set("chat", opts.chat);
    if (opts.from) params.set("from", opts.from);
    return request(`/api/search?${params.toString()}`);
  },
  async gallery(chatGuid: string): Promise<GalleryAttachment[]> {
    const conversation = await convexClient.query(commaApi.resolveChat, { chatGuid });
    return conversation ? convexClient.query(mediaApi.gallery, { conversationId: conversation._id }) : [];
  },
  chatInfo(chatGuid: string): Promise<{
    guid: string;
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/info`);
  },
  async renameGroup(chatGuid: string, name: string): Promise<{ ok: boolean }> {
    return enqueueCommand(chatGuid, { kind: "rename", name });
  },
  participant(chatGuid: string, address: string, action: "add" | "remove"): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/participant`, {
      method: "POST",
      body: JSON.stringify({ address, action }),
    });
  },
  leaveGroup(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/leave`, { method: "POST" });
  },
  deleteChat(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/delete`, { method: "POST" });
  },
  schedule(chatGuid: string, text: string, sendAt: number): Promise<ScheduledMessage> {
    return request("/api/scheduled", {
      method: "POST",
      body: JSON.stringify({ chatGuid, text, sendAt }),
    });
  },
  updateScheduled(id: number, chatGuid: string, text: string, sendAt: number): Promise<ScheduledMessage> {
    return request(`/api/scheduled/${id}`, {
      method: "PUT",
      body: JSON.stringify({ chatGuid, text, sendAt }),
    });
  },
  cancelScheduled(id: number): Promise<{ ok: boolean }> {
    return request(`/api/scheduled/${id}`, { method: "DELETE" });
  },
  sendScheduledNow(id: number): Promise<{ ok: true }> {
    return request(`/api/scheduled/${id}/send-now`, { method: "POST" });
  },
  transcriptState(attachmentGuid: string): Promise<TranscriptState> {
    return convexClient.query(mediaApi.transcriptState, { attachmentGuid });
  },
  async transcribe(attachmentGuid: string, chatGuid?: string): Promise<TranscriptState> {
    const chat = chatGuid ?? await convexClient.query(mediaApi.attachmentChatGuid, { guid: attachmentGuid });
    if (!chat) throw new Error("Attachment conversation is unavailable");
    return (await runCommand(chat, { kind: "transcribe", attachmentGuid })).transcript;
  },
  createFaceTimeLink(chatGuid: string): Promise<{ message: Message }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/facetime-link`, { method: "POST" });
  },
  health(): Promise<{ ok: boolean; privateApi: boolean }> {
    return request("/api/health");
  },
  /**
   * Fire-and-forget: tells the server to refresh its Identity Mirror (the
   * Convex name directory) right away, so an in-app "Add Contact" / rename
   * shows up in the inbox immediately instead of waiting for the mirror's
   * own 5-minute tick. 204 response — bypasses `request()`'s JSON parse.
   */
  refreshIdentity(): Promise<void> {
    return fetch(`${BASE_URL}/api/identity/refresh`, { method: "POST" }).then(() => undefined);
  },

  // ------------------------------------------------------------------- ai
  aiStatus(): Promise<AiStatus> {
    return request("/api/ai/status");
  },

  aiSuggestions(chatGuid: string, model: SuggestionModel, refresh = false): Promise<ReplySuggestions> {
    const params = new URLSearchParams({ model });
    if (refresh) params.set("refresh", "1");
    return request(`/api/ai/suggestions/${encodeURIComponent(chatGuid)}?${params.toString()}`);
  },
  recordSuggestionFeedback(chatGuid: string, body: SuggestionFeedbackRequest): Promise<{ ok: boolean }> {
    return request(`/api/ai/suggestions/${encodeURIComponent(chatGuid)}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  clearSuggestionLearning(): Promise<{ ok: boolean }> {
    return request("/api/ai/suggestions/learning", { method: "DELETE" });
  },
  aiIdentify(chatGuid: string): Promise<ContactSuggestion> {
    return request(`/api/ai/identify/${encodeURIComponent(chatGuid)}`);
  },

};

export function avatarUrl(address: string, photoUrl?: string | null): string {
  return photoUrl ?? `${BASE_URL}/api/avatars/${encodeURIComponent(address)}?v=3`;
}

export function groupPhotoUrl(chatGuid: string): string {
  return `${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/photo?v=2`;
}

export function attachmentUrl(attachment: string | Pick<AttachmentSummary, "originalUrl">): string | null {
  return storedAttachmentUrl(attachment);
}

export function attachmentThumbnailUrl(attachment: string | Pick<AttachmentSummary, "originalUrl" | "thumbUrl">, _displayWidth: number): string | null {
  return storedAttachmentThumbnailUrl(attachment);
}
