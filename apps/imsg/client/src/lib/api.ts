import { messageToMessage } from "./convex-adapters";
import { commaApi } from "./convex-api";
import { runCommand } from "./convex-commands";
import { createMessagingApi } from "./messaging-api";
import { convexClient } from "./identity";
import { searchMessages } from "./history-api";
import { contactSearchArgs, identityApi } from "./identity-api";
import { createAiApi } from "./ai-api";
import { mediaApi, storedAttachmentUrl, storedAttachmentThumbnailUrl, type GalleryAttachment } from "./media-api";
import type {
  AttachmentSummary,
  Contact,
  GalleryItem,
  ContactSuggestion,
  ConversationId,
  Message,
  Platform,
  ScheduledMessage,
  TranscriptState,
} from "@shared/types";

async function scheduledConversation(id: number): Promise<ConversationId> {
  const rows = await convexClient.query(commaApi.listScheduled, {});
  const conversationId = rows.find((row) => row.bbId === id)?.conversationId;
  if (!conversationId) throw new Error("Scheduled message is unavailable");
  return conversationId;
}

const messagingApi = createMessagingApi(runCommand);

/** A search result names the conversation it belongs to. */
export type SearchHit = Message & { conversationId: ConversationId };

export const api = {
  sendText: messagingApi.sendText,
  contacts(q: string): Promise<Contact[]> {
    return convexClient.query(identityApi.searchContacts, contactSearchArgs(q));
  },
  sendContactCard(conversationId: ConversationId, contact: Contact, caption?: string): Promise<Message> {
    return messagingApi.sendContactCard(conversationId, contact, caption);
  },
  async findChat(address: string): Promise<{ conversationId: ConversationId }> {
    const result = await convexClient.query(identityApi.findChat, { address });
    if (!result) throw new Error("Chat not found");
    return result;
  },
  newChat: messagingApi.newChat,
  async search(q: string, opts: { conversationId?: ConversationId; from?: "me" | "them"; platform?: Platform } = {}): Promise<SearchHit[]> {
    const rows = await convexClient.query(searchMessages, {
      query: q,
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.platform ? { platform: opts.platform } : {}),
    });
    return rows.map((row) => ({ ...messageToMessage(row), conversationId: row.conversationId }));
  },
  gallery(conversationId: ConversationId): Promise<GalleryAttachment[]> {
    return convexClient.query(mediaApi.gallery, { conversationId });
  },
  async chatInfo(conversationId: ConversationId): Promise<{
    guid: string;
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  }> {
    const result = await convexClient.query(identityApi.chatInfo, { conversationId });
    if (!result) throw new Error("Chat not found");
    return result;
  },
  participant: messagingApi.participant,
  leaveGroup: messagingApi.leaveGroup,
  deleteChat: messagingApi.deleteChat,
  async schedule(conversationId: ConversationId, text: string, sendAt: number): Promise<ScheduledMessage> {
    return (await runCommand(conversationId, { kind: "schedule", text, sendAt })).scheduled;
  },
  async updateScheduled(id: number, conversationId: ConversationId, text: string, sendAt: number): Promise<ScheduledMessage> {
    return (await runCommand(conversationId, { kind: "editScheduled", bbId: id, text, sendAt })).scheduled;
  },
  async cancelScheduled(id: number): Promise<{ ok: boolean }> {
    return runCommand(await scheduledConversation(id), { kind: "cancelScheduled", bbId: id });
  },
  async sendScheduledNow(id: number): Promise<{ ok: true }> {
    return runCommand(await scheduledConversation(id), { kind: "sendScheduledNow", bbId: id });
  },
  transcriptState(attachmentGuid: string): Promise<TranscriptState> {
    return convexClient.query(mediaApi.transcriptState, { attachmentGuid });
  },
  createFaceTimeLink: messagingApi.createFaceTimeLink,
  // ------------------------------------------------------------------- ai
  ...createAiApi(convexClient),

};

export function avatarUrl(_address: string, photoUrl?: string | null): string | null {
  return photoUrl ?? null;
}

export function groupPhotoUrl(chat: { groupPhotoUrl?: string | null }): string | null {
  return chat.groupPhotoUrl ?? null;
}

export function attachmentUrl(attachment: string | Pick<AttachmentSummary, "originalUrl">): string | null {
  return storedAttachmentUrl(attachment);
}

export function attachmentThumbnailUrl(attachment: string | Pick<AttachmentSummary, "originalUrl" | "thumbUrl">, _displayWidth: number): string | null {
  return storedAttachmentThumbnailUrl(attachment);
}
