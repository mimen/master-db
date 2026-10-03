import { conversationKey } from "../../../../convex/comma/conversationKey";
import type { BBChat, BBMessage } from "../bb-types";
import { mapChat, mapMessage, parseTapback } from "../map";
import type { NameSource } from "../name-resolver";
import type { AttachmentRow, ConversationInput, MessageRow } from "./convex-ingest";

const unnamed: NameSource = {
  available: false,
  lookup: () => null,
  searchTerms: () => [],
  chatCrm: () => undefined,
  personCrm: () => undefined,
};
const serviceRank: Record<string, number> = { iMessage: 0, RCS: 1, SMS: 2 };

export function toConversationInputs(bbChats: BBChat[], names: NameSource = unnamed): ConversationInput[] {
  const groups = new Map<string, BBChat[]>();
  for (const chat of bbChats) {
    const summary = mapChat(chat, undefined, names);
    const key = conversationKey({
      isGroup: summary.isGroup,
      primaryChatGuid: chat.guid,
      participants: summary.participants,
    });
    const siblings = groups.get(key) ?? [];
    siblings.push(chat);
    groups.set(key, siblings);
  }
  return [...groups].map(([key, siblings]) => {
    siblings.sort((a, b) =>
      (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0) ||
      (serviceRank[a.guid.split(";")[0]] ?? 9) - (serviceRank[b.guid.split(";")[0]] ?? 9) ||
      a.guid.localeCompare(b.guid));
    const primary = mapChat(siblings[0], undefined, names);
    return {
      conversationKey: key,
      chats: siblings.map((chat) => ({ chatGuid: chat.guid, lastMessageAt: chat.lastMessage?.dateCreated ?? 0 })),
      displayName: primary.displayName,
      isGroup: primary.isGroup,
      participants: primary.participants,
      isSpam: primary.isSpam,
      hasGroupPhoto: primary.hasGroupPhoto === true,
      lastMessage: primary.lastMessage ?? undefined,
      lastMessageAt: primary.lastMessage?.dateCreated ?? 0,
    };
  });
}

/** Backfill uses revision 0. Continuous sync persists per-GUID versions above this base in OverlayDb. */
export function sourceVersion(message: BBMessage, editSequence = 0): number {
  const rowid = message.originalROWID;
  if (!Number.isSafeInteger(rowid) || !rowid || rowid < 1) throw new Error(`Missing message ROWID for ${message.guid}`);
  if (!Number.isInteger(editSequence) || editSequence < 0 || editSequence >= 1000) throw new Error("Invalid edit sequence");
  const version = rowid * 1000 + editSequence;
  if (!Number.isSafeInteger(version)) throw new Error("Message sourceVersion overflow");
  return version;
}

export function toMessageRow(
  bbMessage: BBMessage,
  conversationId: MessageRow["conversationId"],
  sourceVersion: number,
  names: NameSource = unnamed,
): MessageRow {
  const chatGuid = bbMessage.chats?.[0]?.guid;
  if (!chatGuid) throw new Error(`Message ${bbMessage.guid} has no chat`);
  const mapped = mapMessage(bbMessage, chatGuid, names, bbMessage.chats?.[0]?.participants);
  const reaction = parseTapback(bbMessage);
  const targetGuid = bbMessage.associatedMessageGuid?.replace(/^b?p:\d+\//, "");
  return {
    guid: mapped.guid,
    conversationId,
    chatGuid,
    dateCreated: mapped.dateCreated,
    dateRead: mapped.dateRead ?? undefined,
    dateDelivered: mapped.dateDelivered ?? undefined,
    dateEdited: bbMessage.dateEdited ?? undefined,
    dateRetracted: bbMessage.dateRetracted ?? undefined,
    isFromMe: mapped.isFromMe,
    text: mapped.isAssociatedMessage ? "" : mapped.text,
    service: mapped.service,
    sender: mapped.sender ?? undefined,
    error: mapped.error,
    edited: mapped.edited,
    retracted: mapped.retracted,
    isTapback: mapped.isAssociatedMessage === true,
    tapbackTargetGuid: reaction ? targetGuid : undefined,
    tapback: reaction && targetGuid ? {
      targetGuid, reaction: reaction.type, emoji: reaction.emoji, remove: reaction.remove,
    } : undefined,
    reactions: [],
    replyToGuid: mapped.replyToGuid ?? undefined,
    replyToPreview: mapped.replyToPreview ?? undefined,
    replyToFromMe: mapped.replyToFromMe ?? undefined,
    isGroupEvent: mapped.isGroupEvent,
    isSpam: mapped.isSpam,
    special: mapped.special ?? undefined,
    sendEffect: mapped.sendEffect ?? undefined,
    mentions: mapped.mentions ?? [],
    attachmentGuids: (bbMessage.attachments ?? []).map((attachment) => attachment.guid),
    sourceVersion,
  };
}

export function toAttachmentRows(
  bbMessage: BBMessage,
  conversationId: AttachmentRow["conversationId"],
  sourceVersion: number,
): AttachmentRow[] {
  return (bbMessage.attachments ?? []).map((attachment) => ({
    guid: attachment.guid,
    messageGuid: bbMessage.guid,
    conversationId,
    mimeType: attachment.mimeType ?? undefined,
    filename: attachment.transferName ?? undefined,
    transferName: attachment.transferName ?? undefined,
    uti: attachment.uti ?? undefined,
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined,
    totalBytes: attachment.totalBytes ?? undefined,
    transferState: attachment.transferState,
    isSticker: attachment.isSticker === true,
    hideAttachment: attachment.hideAttachment === true,
    isOnDisk: attachment.transferState === 5,
    sourceVersion,
  }));
}
