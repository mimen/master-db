import type { FunctionArgs } from "convex/server";
import { BASE_URL } from "./config";
import { attachmentSource, messageToMessage } from "./convex-adapters";
import { commaApi, commaOutbox } from "./convex-api";
import { convexClient } from "./identity";
import { currentConvexSends, currentDataSource } from "./settings";
import type {
  AttachmentSummary,
  AiStatus,
  ChatSummary,
  Contact,
  ContactSuggestion,
  GalleryItem,
  Message,
  ReplySuggestions,
  ScheduledMessage,
  SendTextRequest,
  StateCounts,
  SuggestionFeedbackRequest,
  SuggestionModel,
  StateFilter,
  TranscriptState,
  TypeFilter,
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

type CommandPayload = FunctionArgs<typeof commaOutbox.enqueue>["payload"];
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

export async function enqueueCommand(chatGuid: string, payload: CommandPayload): Promise<boolean> {
  if (!currentConvexSends() || currentDataSource() !== "convex") return false;
  const conversation = await convexClient.query(commaApi.resolveChat, { chatGuid });
  if (!conversation) return false;
  await convexClient.mutation(commaOutbox.enqueue, {
    clientKey: `command-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    conversationId: conversation._id,
    payload,
  });
  return true;
}

export const api = {
  chats(state: StateFilter, type: TypeFilter): Promise<ChatSummary[]> {
    return request(`/api/chats?state=${state}&type=${type}`);
  },
  /** Raw, unfiltered list — for clients that filter locally. */
  allChats(): Promise<ChatSummary[]> {
    return request(`/api/chats?state=any`);
  },
  counts(type: TypeFilter): Promise<StateCounts> {
    return request(`/api/counts?type=${type}`);
  },
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
  /**
   * Queue a plain text send through the Convex outbox. Resolves once Convex
   * has the row; the bubble then settles when the bridge's echo arrives
   * (matched by clientKey). Returns false when the chat isn't mirrored yet,
   * so the caller falls back to the REST send.
   */
  async enqueueTextSend(chatGuid: string, clientKey: string, body: SendTextRequest): Promise<boolean> {
    // Sends through Convex only make sense when the thread also reads from Convex.
    if (!currentConvexSends() || currentDataSource() !== "convex" || body.mentions?.length) return false;
    const conversation = await convexClient.query(commaApi.resolveChat, { chatGuid });
    if (!conversation) return false;
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
    if (await enqueueCommand(chatGuid, { kind: "markRead" })) return { ok: true };
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/read`, { method: "POST" });
  },
  async markUnread(chatGuid: string): Promise<{ ok: boolean }> {
    if (await enqueueCommand(chatGuid, { kind: "markUnread" })) return { ok: true };
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/unread`, { method: "POST" });
  },
  async dismiss(
    chatGuid: string,
    kind: "unresponded" | "waiting",
    expectedLatestMessageGuid?: string,
  ): Promise<{ ok: boolean }> {
    if (await enqueueCommand(chatGuid, {
      kind: "settle",
      ...(expectedLatestMessageGuid !== undefined ? { messageGuid: expectedLatestMessageGuid } : {}),
    })) return { ok: true };
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ kind, expectedLatestMessageGuid }),
    });
  },
  async undismiss(chatGuid: string, kind: "unresponded" | "waiting"): Promise<{ ok: boolean }> {
    if (await enqueueCommand(chatGuid, { kind: "unsettle" })) return { ok: true };
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/undismiss`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
  },
  async setPinned(chatGuid: string, pinned: boolean): Promise<{ ok: boolean }> {
    if (await enqueueCommand(chatGuid, { kind: "pin", value: pinned })) return { ok: true };
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinned }),
    });
  },
  async react(
    messageGuid: string,
    body: { chatGuid: string; reaction: string; remove?: boolean; partIndex?: number; suggested?: boolean },
  ): Promise<{ ok: boolean }> {
    // Suggested reactions need the REST handler's inbound-target guard.
    if (!body.suggested && await enqueueCommand(body.chatGuid, {
      kind: "react", messageGuid, reaction: body.reaction, remove: body.remove ?? false,
      ...(body.partIndex !== undefined ? { partIndex: body.partIndex } : {}),
    })) return { ok: true };
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/react`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  async unsend(messageGuid: string): Promise<{ ok: boolean }> {
    const chatGuid = messageChatGuid(messageGuid);
    if (chatGuid && await enqueueCommand(chatGuid, { kind: "unsend", messageGuid })) return { ok: true };
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/unsend`, { method: "POST" });
  },
  async deleteMessage(messageGuid: string, chatGuid: string): Promise<{ ok: boolean }> {
    if (await enqueueCommand(chatGuid, { kind: "delete", messageGuid })) return { ok: true };
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatGuid }),
    });
  },
  async edit(messageGuid: string, text: string): Promise<{ ok: boolean }> {
    const chatGuid = messageChatGuid(messageGuid);
    if (chatGuid && await enqueueCommand(chatGuid, { kind: "edit", messageGuid, text })) return { ok: true };
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/edit`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
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
    if (currentDataSource() === "convex" && !opts.from) {
      const conversation = opts.chat ? await convexClient.query(commaApi.resolveChat, { chatGuid: opts.chat }) : null;
      if (!opts.chat || conversation) {
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
  gallery(chatGuid: string): Promise<GalleryItem[]> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/gallery`);
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
    if (await enqueueCommand(chatGuid, { kind: "rename", name })) return { ok: true };
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
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
  listScheduled(): Promise<ScheduledMessage[]> {
    return request("/api/scheduled");
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
    return request(`/api/attachments/${encodeURIComponent(attachmentGuid)}/transcript`);
  },
  transcribe(attachmentGuid: string): Promise<TranscriptState> {
    return request(`/api/attachments/${encodeURIComponent(attachmentGuid)}/transcript`, { method: "POST" });
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

export function avatarUrl(address: string): string {
  return `${BASE_URL}/api/avatars/${encodeURIComponent(address)}?v=3`;
}

export function groupPhotoUrl(chatGuid: string): string {
  return `${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/photo?v=2`;
}

export function attachmentUrl(attachment: string | AttachmentSummary): string {
  const guid = typeof attachment === "string" ? attachment : attachment.guid;
  const fallback = `${BASE_URL}/api/attachments/${encodeURIComponent(guid)}`;
  return typeof attachment === "string" ? fallback : attachmentSource(attachment, fallback);
}

/** A small cached JPEG for in-thread display; the server snaps width to 260/520/1040 and serves GIFs whole. */
export function attachmentThumbnailUrl(attachment: string | AttachmentSummary, displayWidth: number): string {
  const guid = typeof attachment === "string" ? attachment : attachment.guid;
  const fallback = `${attachmentUrl(guid)}?w=${Math.ceil(displayWidth * 2)}`;
  return typeof attachment === "string" ? fallback : attachmentSource(attachment, fallback, true);
}
