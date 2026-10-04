import { messageToMessage } from "./convex-adapters";
import { commaApi, commaOutbox } from "./convex-api";
import { enqueueVia, runCommand, type CommandClient, type CommandPayload } from "./convex-commands";
import { createMessagingApi, enqueueTextSendVia } from "./messaging-api";
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
  Message,
  ScheduledMessage,
  SendTextRequest,
  TranscriptState,
} from "@shared/types";

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

const messagingApi = createMessagingApi(runCommand);

export const api = {
  async enqueueTextSend(chatGuid: string, clientKey: string, body: SendTextRequest): Promise<boolean> {
    return enqueueTextSendVia(convexClient as unknown as CommandClient, chatGuid, clientKey, body);
  },
  sendText: messagingApi.sendText,
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
    if (!body.suggested) return enqueueCommand(body.chatGuid, {
      kind: "react", messageGuid, reaction: body.reaction, remove: body.remove ?? false,
      ...(body.partIndex !== undefined ? { partIndex: body.partIndex } : {}),
    });
    return runCommand(body.chatGuid, { kind: "react", messageGuid, reaction: body.reaction,
      remove: body.remove ?? false, partIndex: body.partIndex, suggested: true });
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
    return messagingApi.sendContactCard(chatGuid, contact, caption);
  },
  async findChat(address: string): Promise<{ chatGuid: string }> {
    const result = await convexClient.query(identityApi.findChat, { address });
    if (!result) throw new Error("Chat not found");
    return result;
  },
  newChat: messagingApi.newChat,
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
  async gallery(chatGuid: string): Promise<GalleryAttachment[]> {
    const conversation = await convexClient.query(commaApi.resolveChat, { chatGuid });
    return conversation ? convexClient.query(mediaApi.gallery, { conversationId: conversation._id }) : [];
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
  participant: messagingApi.participant,
  leaveGroup: messagingApi.leaveGroup,
  deleteChat: messagingApi.deleteChat,
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
    return convexClient.query(mediaApi.transcriptState, { attachmentGuid });
  },
  async transcribe(attachmentGuid: string, chatGuid?: string): Promise<TranscriptState> {
    const chat = chatGuid ?? await convexClient.query(mediaApi.attachmentChatGuid, { guid: attachmentGuid });
    if (!chat) throw new Error("Attachment conversation is unavailable");
    return (await runCommand(chat, { kind: "transcribe", attachmentGuid })).transcript;
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
