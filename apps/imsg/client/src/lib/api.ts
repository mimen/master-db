import type { MentionAnnotation } from "@shared/mentions";
import { messageToMessage } from "./convex-adapters";
import { scheduledSendsApi } from "./convex-api";
import { runCommand } from "./convex-commands";
import { createMessagingApi } from "./messaging-api";
import { convexClient } from "./identity";
import { searchMessages } from "./history-api";
import { contactSearchArgs, identityApi } from "./identity-api";
import { createAiApi } from "./ai-api";
import { mediaApi, storedAttachmentUrl, storedAttachmentThumbnailUrl, type GalleryAttachment } from "./media-api";
import type {
  AttachmentSummary,
  ChatSummary,
  Contact,
  GalleryItem,
  ContactSuggestion,
  ConversationId,
  Message,
  Platform,
  TranscriptState,
} from "@shared/types";
import type { GenericId } from "convex/values";
import type { ScheduledItem } from "./scheduled";

function scheduledConversation(item: ScheduledItem): ConversationId {
  if (!item.conversationId) throw new Error("Scheduled message is unavailable");
  return item.conversationId;
}

const commaScheduledId = (item: ScheduledItem) => item.id as GenericId<"comma_scheduled">;

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
  /** iMessage schedules in BlueBubbles; Slack and Gmail in Convex, which sends at the time. */
  async schedule(chat: Pick<ChatSummary, "conversationId" | "route">, message: { text: string; replyToGuid?: string; mentions?: MentionAnnotation[] }, sendAt: number): Promise<void> {
    if (chat.route.platform === "imessage") await runCommand(chat.conversationId, { kind: "schedule", text: message.text, sendAt });
    else await convexClient.mutation(scheduledSendsApi.schedule, { conversationId: chat.conversationId, payload: { kind: "send", ...message }, sendAt });
  },
  async updateScheduled(item: ScheduledItem, text: string, sendAt: number): Promise<void> {
    if (item.bbId === undefined) await convexClient.mutation(scheduledSendsApi.edit, { scheduledId: commaScheduledId(item), text, sendAt });
    else await runCommand(scheduledConversation(item), { kind: "editScheduled", bbId: item.bbId, text, sendAt });
  },
  async cancelScheduled(item: ScheduledItem): Promise<void> {
    if (item.bbId === undefined) await convexClient.mutation(scheduledSendsApi.cancel, { scheduledId: commaScheduledId(item) });
    else await runCommand(scheduledConversation(item), { kind: "cancelScheduled", bbId: item.bbId });
  },
  async sendScheduledNow(item: ScheduledItem): Promise<void> {
    if (item.bbId === undefined) await convexClient.mutation(scheduledSendsApi.sendNow, { scheduledId: commaScheduledId(item) });
    else await runCommand(scheduledConversation(item), { kind: "sendScheduledNow", bbId: item.bbId });
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
