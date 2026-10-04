import type { FunctionReturnType } from "convex/server";
import type { AttachmentSummary, ChatSummary, Message, ScheduledMessage } from "@shared/types";
import type { commaApi } from "./convex-api";

export type ConvexConversation = FunctionReturnType<typeof commaApi.listConversations>["page"][number];
export type ConvexMessage = FunctionReturnType<typeof commaApi.listMessages>["page"][number];
export type ConvexSearchMessage = FunctionReturnType<typeof commaApi.searchMessages>[number];
export type ConvexScheduled = FunctionReturnType<typeof commaApi.listScheduled>[number];

export function conversationToChat(row: ConvexConversation): ChatSummary {
  return {
    conversationId: row._id,
    guid: row.primaryChatGuid,
    displayName: row.displayName,
    isGroup: row.isGroup,
    hasGroupPhoto: row.hasGroupPhoto,
    groupPhotoUrl: row.groupPhotoUrl,
    participants: row.participants,
    known: row.participants.some((p) => p.name !== null),
    contactsAvailable: true,
    isSpam: row.isSpam,
    lastMessage: row.lastMessage ?? null,
    unreadCount: row.unreadCount,
    firstUnreadAt: null,
    flags: row.flags,
    searchNames: [],
  };
}

function visibleAttachments(attachments: ConvexMessage["attachments"]): ConvexMessage["attachments"] {
  const shown = attachments.filter((a) => !a.hideAttachment);
  const groups = new Map<string, ConvexMessage["attachments"]>();
  for (const a of shown) {
    const key = (a.transferName ?? a.filename ?? a.guid).toLowerCase().replace(/\.(heic|heif)\.jpe?g$/, ".$1");
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const dropped = new Set<ConvexMessage["attachments"][number]>();
  const rank = (a: ConvexMessage["attachments"][number]) => Number(a.isOnDisk) * 2 + Number(a.mimeType === "image/jpeg");
  for (const [key, group] of groups) {
    const keep = group.reduce((best, a) =>
      rank(a) > rank(best) || (rank(a) === rank(best) && (a.width ?? 0) > (best.width ?? 0)) ? a : best);
    for (const a of group) {
      if (a !== keep && (/\.(heic|heif)$/.test(key) || !a.isOnDisk)) dropped.add(a);
    }
  }
  return shown.filter((a) => !dropped.has(a));
}

export function messageToMessage(row: ConvexMessage | ConvexSearchMessage): Message {
  const attachments = "attachments" in row ? visibleAttachments(row.attachments) : [];
  return {
    guid: row.guid,
    chatGuid: row.chatGuid,
    text: row.text,
    dateCreated: row.dateCreated,
    dateRead: row.dateRead ?? null,
    dateDelivered: row.dateDelivered ?? null,
    isFromMe: row.isFromMe,
    service: row.service,
    sender: row.sender ?? null,
    attachments: attachments.map((a) => ({
      guid: a.guid,
      mimeType: a.mimeType ?? null,
      filename: a.filename ?? a.transferName ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      totalBytes: a.totalBytes ?? null,
      thumbUrl: a.thumbUrl,
      originalUrl: a.originalUrl,
    })),
    mentions: row.mentions,
    special: row.special ?? null,
    sendEffect: row.sendEffect ?? null,
    reactions: row.reactions,
    replyToGuid: row.replyToGuid ?? null,
    replyToPreview: row.replyToPreview ?? null,
    replyToFromMe: row.replyToFromMe ?? null,
    isAssociatedMessage: row.isTapback,
    isGroupEvent: row.isGroupEvent,
    isSpam: row.isSpam,
    error: row.error,
    edited: row.edited,
    retracted: row.retracted,
    clientKey: row.clientKey,
    // A queued send's optimistic row, before the bridge's echo replaces it.
    ...(row.guid.startsWith("temp-") ? (row.error ? { failed: true } : { pending: true }) : {}),
  };
}

export function attachmentSource(attachment: AttachmentSummary, fallback: string, thumbnail = false): string {
  return (thumbnail ? attachment.thumbUrl ?? attachment.originalUrl : attachment.originalUrl) ?? fallback;
}

export function scheduledToScheduled(row: ConvexScheduled, chats: readonly ChatSummary[]): ScheduledMessage {
  return {
    id: row.bbId,
    chatGuid: row.chatGuid,
    chatName: chats.find((c) => (row.conversationId && c.conversationId === row.conversationId) || c.guid === row.chatGuid)?.displayName ?? row.chatGuid,
    text: row.text,
    sendAt: row.sendAt,
    status: row.status,
    error: row.error ?? null,
    sentAt: row.sentAt ?? null,
  };
}

/** Keep local sends through the REST acknowledgement until the bridge echoes their guid or clientKey. */
export function mergeConvexMessages(remote: readonly Message[], local: readonly Message[]): Message[] {
  const byGuid = new Map(local.map((m) => [m.guid, m]));
  const byKey = new Map(local.filter((m) => m.clientKey).map((m) => [m.clientKey, m]));
  const claimed = new Set<Message>();
  const merged = remote.map((m) => {
    const own = byGuid.get(m.guid) ?? (m.clientKey ? byKey.get(m.clientKey) : undefined);
    if (own) claimed.add(own);
    // A queued send's Convex row is `temp-<clientKey>`; adopt the local bubble's identity so it never remounts.
    return own?.clientKey ? { ...m, guid: m.guid.startsWith("temp-") ? own.guid : m.guid, clientKey: own.clientKey } : m;
  });
  return [...merged, ...local.filter((m) => !claimed.has(m) && (m.pending || m.failed || m.clientKey))]
    .sort((a, b) => a.dateCreated - b.dateCreated);
}
