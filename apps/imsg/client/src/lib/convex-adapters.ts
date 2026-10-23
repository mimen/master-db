import type { FunctionReturnType } from "convex/server";
import { agentAttention, mostUrgent } from "@shared/agent-attention";
import type { AttachmentSummary, ChatSummary, Message, ScheduledMessage } from "@shared/types";
import type { AgentChatSummary } from "./agent-api";
import type { commaApi } from "./convex-api";

export type ConvexConversation = FunctionReturnType<typeof commaApi.listConversations>["page"][number];
export type ConvexMessage = FunctionReturnType<typeof commaApi.listMessages>["page"][number];
export type ConvexSearchMessage = FunctionReturnType<typeof commaApi.searchMessages>[number];
export type ConvexScheduled = FunctionReturnType<typeof commaApi.listScheduled>[number];

// `unread` and `crm` are optional until the committed generated API catches up with the view.
export function conversationToChat(
  row: ConvexConversation & { unread?: { firstAt: number }; crm?: ChatSummary["crm"] },
): ChatSummary {
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
    firstUnreadAt: row.unreadCount ? row.unread?.firstAt ?? null : null,
    flags: row.flags,
    searchNames: [],
    ...(row.crm ? { crm: row.crm } : {}),
  };
}

type ConvexDraftListItem = FunctionReturnType<typeof commaApi.listDrafts>[number];

/** Marks each conversation that has something in its composer, for the Drafts lens and its rows. */
export function withDrafts(chats: ChatSummary[], drafts: readonly ConvexDraftListItem[]): ChatSummary[] {
  if (drafts.length === 0) return chats;
  const byConversation = new Map(drafts.map(({ conversationId, ...draft }) => [conversationId as string, draft]));
  return chats.map((chat) => {
    const draft = chat.conversationId ? byConversation.get(chat.conversationId) : undefined;
    return draft ? { ...chat, draft } : chat;
  });
}

type RowAgent = NonNullable<ChatSummary["agent"]>;

function sameAgent(a: RowAgent | undefined, b: RowAgent): boolean {
  return a !== undefined && a.attention === b.attention && a.chatId === b.chatId && a.title === b.title &&
    a.openCount === b.openCount && a.activityAt === b.activityAt && a.preview?.kind === b.preview?.kind && a.preview?.text === b.preview?.text;
}

/**
 * Summarizes each conversation's unsettled agent chats by its most urgent one. `previous` is this
 * function's last result: a row whose fields and agent did not change comes back as that same
 * object, and an unchanged list as that same array, because listAgentChats re-sends every summary
 * when any one chat moves.
 */
export function withAgents(chats: ChatSummary[], summaries: readonly AgentChatSummary[], previous: ChatSummary[]): ChatSummary[] {
  if (summaries.length === 0) return chats;
  const open = new Map<string, AgentChatSummary[]>();
  for (const summary of summaries) {
    if (summary.settledAt === undefined) open.set(summary.conversationId, [...(open.get(summary.conversationId) ?? []), summary]);
  }
  const before = new Map(previous.map((row) => [row.guid, row]));
  const joined = chats.map((chat) => {
    const mine = chat.conversationId ? open.get(chat.conversationId) : undefined;
    const top = mine && mostUrgent(mine);
    if (!mine || !top) return chat;
    const attention = agentAttention(top);
    if (attention === "settled") return chat;
    const agent: RowAgent = {
      attention, chatId: top._id, title: top.title, ...(top.preview ? { preview: top.preview } : {}), openCount: mine.length, activityAt: top.updatedAt,
    };
    const last = before.get(chat.guid);
    const keys = Object.keys(chat) as (keyof ChatSummary)[];
    const unchanged = last !== undefined && sameAgent(last.agent, agent) &&
      Object.keys(last).length === keys.length + 1 && keys.every((key) => last[key] === chat[key]);
    return unchanged ? last : { ...chat, agent };
  });
  return joined.length === previous.length && joined.every((row, index) => row === previous[index]) ? previous : joined;
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
      onMac: a.isOnDisk,
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
  // A temp row whose send already settled locally to a real guid is a leftover: the real row
  // owns it, and BlueBubbles echoes rarely carry the clientKey that would otherwise retire it.
  const settledKeys = new Set(local.filter((m) => m.clientKey && !m.guid.startsWith("temp-")).map((m) => m.clientKey));
  const remoteGuids = new Set(remote.map((m) => m.guid));
  const merged = remote.filter((m) => !(m.guid.startsWith("temp-") && m.clientKey && settledKeys.has(m.clientKey) &&
    local.some((own) => own.clientKey === m.clientKey && remoteGuids.has(own.guid)))).map((m) => {
    const own = byGuid.get(m.guid) ?? (m.clientKey ? byKey.get(m.clientKey) : undefined);
    if (own) claimed.add(own);
    // A queued send's Convex row is `temp-<clientKey>`; adopt the local bubble's identity so it never remounts.
    return own?.clientKey ? { ...m, guid: m.guid.startsWith("temp-") ? own.guid : m.guid, clientKey: own.clientKey } : m;
  });
  return [...merged, ...local.filter((m) => !claimed.has(m) && (m.pending || m.failed || m.clientKey))]
    .sort((a, b) => a.dateCreated - b.dateCreated);
}
