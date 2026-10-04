import { BASE_URL } from "./config";
import { attachmentSource, messageToMessage } from "./convex-adapters";
import { commaApi, commaOutbox } from "./convex-api";
import { enqueueVia, runCommand, type CommandClient, type CommandPayload } from "./convex-commands";
import { convexClient } from "./identity";
import { searchMessages } from "./history-api";
import { contactSearchArgs, identityApi } from "./identity-api";
import { createAiApi } from "./ai-api";
import type {
  AttachmentSummary,
  Contact,
  GalleryItem,
  Message,
  ScheduledMessage,
  SendTextRequest,
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

async function scheduledChatGuid(id: number): Promise<string> {
  const rows = await convexClient.query(commaApi.listScheduled, {});
  const scheduled = rows.find((row) => row.bbId === id);
  if (!scheduled) throw new Error("Scheduled message is unavailable");
  return scheduled.chatGuid;
}

export const api = {
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
    return convexClient.query(identityApi.searchContacts, contactSearchArgs(q));
  },
  sendContactCard(chatGuid: string, contact: Contact, caption?: string): Promise<Message> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: contact.name, address: contact.address, caption }),
    });
  },
  async findChat(address: string): Promise<{ chatGuid: string }> {
    const result = await convexClient.query(identityApi.findChat, { address });
    if (!result) throw new Error("Chat not found");
    return result;
  },
  newChat(body: { addresses: string[]; text: string }): Promise<{ chatGuid: string }> {
    return request("/api/chats/new", { method: "POST", body: JSON.stringify(body) });
  },
  async search(q: string, opts: { chat?: string; from?: "me" | "them" } = {}): Promise<Message[]> {
    const conversation = opts.chat ? await convexClient.query(commaApi.resolveChat, { chatGuid: opts.chat }) : null;
    if (opts.chat && !conversation) return [];
    const rows = await convexClient.query(searchMessages, {
      query: q,
      ...(conversation ? { conversationId: conversation._id } : {}),
      ...(opts.from ? { from: opts.from } : {}),
    });
    return rows.map(messageToMessage);
  },
  gallery(chatGuid: string): Promise<GalleryItem[]> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/gallery`);
  },
  async chatInfo(chatGuid: string): Promise<{
    guid: string;
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  }> {
    const result = await convexClient.query(identityApi.chatInfo, { chatGuid });
    if (!result) throw new Error("Chat not found");
    return result;
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
  async schedule(chatGuid: string, text: string, sendAt: number): Promise<ScheduledMessage> {
    return (await runCommand(chatGuid, { kind: "schedule", text, sendAt })).scheduled;
  },
  async updateScheduled(id: number, chatGuid: string, text: string, sendAt: number): Promise<ScheduledMessage> {
    return (await runCommand(chatGuid, { kind: "editScheduled", bbId: id, text, sendAt })).scheduled;
  },
  async cancelScheduled(id: number): Promise<{ ok: boolean }> {
    return runCommand(await scheduledChatGuid(id), { kind: "cancelScheduled", bbId: id });
  },
  async sendScheduledNow(id: number): Promise<{ ok: true }> {
    return runCommand(await scheduledChatGuid(id), { kind: "sendScheduledNow", bbId: id });
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
  // ------------------------------------------------------------------- ai
  ...createAiApi(convexClient),

};

export function avatarUrl(_address: string, photoUrl?: string | null): string | null {
  return photoUrl ?? null;
}

export function groupPhotoUrl(chat: { groupPhotoUrl?: string | null }): string | null {
  return chat.groupPhotoUrl ?? null;
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
