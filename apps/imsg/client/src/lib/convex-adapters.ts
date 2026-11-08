import type { FunctionReturnType } from "convex/server";
import { agentAttention, mostUrgent } from "@shared/agent-attention";
import { isPendingGuid } from "@shared/pending-send";
import type { AttachmentSummary, ChatSummary, Message, ScheduledMessage } from "@shared/types";
import type { AgentChatSummary } from "./agent-api";
import type { commaApi } from "./convex-api";
import { sortThread } from "./message-window";

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
    // ponytail: every row has a chat until Slack's rows land; ChatRoute becomes a union by platform then.
    route: { platform: row.platform ?? "imessage", accountId: row.accountId ?? null, imessage: { chatGuid: row.primaryChatGuid ?? "" } },
    displayName: row.displayName,
    kind: row.kind,
    isGroup: row.isGroup,
    hasGroupPhoto: row.hasGroupPhoto,
    groupPhotoUrl: row.groupPhotoUrl,
    participants: row.participants,
    known: row.known,
    contactsAvailable: row.contactsAvailable,
    isSpam: row.isSpam,
    lastMessage: row.lastMessage ?? null,
    unreadCount: row.unreadCount,
    firstUnreadAt: row.unreadCount ? row.unread?.firstAt ?? null : null,
    flags: row.flags,
    searchNames: row.searchNames,
    ...(row.crm ? { crm: row.crm } : {}),
  };
}

type ConvexDraftListItem = FunctionReturnType<typeof commaApi.listDrafts>[number];

/** Marks each conversation that has something in its composer, for the Drafts lens and its rows. */
export function withDrafts(chats: ChatSummary[], drafts: readonly ConvexDraftListItem[]): ChatSummary[] {
  if (drafts.length === 0) return chats;
  const byConversation = new Map(drafts.map(({ conversationId, ...draft }) => [conversationId, draft]));
  return chats.map((chat) => {
    const draft = byConversation.get(chat.conversationId);
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
  const before = new Map(previous.map((row) => [row.conversationId, row]));
  const joined = chats.map((chat) => {
    const mine = open.get(chat.conversationId);
    const top = mine && mostUrgent(mine);
    if (!mine || !top) return chat;
    const attention = agentAttention(top);
    if (attention === "settled") return chat;
    const agent: RowAgent = {
      attention, chatId: top._id, title: top.title, ...(top.preview ? { preview: top.preview } : {}), openCount: mine.length, activityAt: top.updatedAt,
    };
    const last = before.get(chat.conversationId);
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
    const key = (a.imessage?.transferName ?? a.filename ?? a.guid).toLowerCase().replace(/\.(heic|heif)\.jpe?g$/, ".$1");
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const dropped = new Set<ConvexMessage["attachments"][number]>();
  const onDisk = (a: ConvexMessage["attachments"][number]) => a.imessage?.isOnDisk ?? true;
  const rank = (a: ConvexMessage["attachments"][number]) => Number(onDisk(a)) * 2 + Number(a.mimeType === "image/jpeg");
  for (const [key, group] of groups) {
    const keep = group.reduce((best, a) =>
      rank(a) > rank(best) || (rank(a) === rank(best) && (a.width ?? 0) > (best.width ?? 0)) ? a : best);
    for (const a of group) {
      if (a !== keep && (/\.(heic|heif)$/.test(key) || !onDisk(a))) dropped.add(a);
    }
  }
  return shown.filter((a) => !dropped.has(a));
}

export function messageToMessage(row: ConvexMessage | ConvexSearchMessage): Message {
  const attachments = "attachments" in row ? visibleAttachments(row.attachments) : [];
  const imessage = row.imessage;
  return {
    guid: row.guid,
    platform: row.platform ?? "imessage",
    text: row.text,
    dateCreated: row.dateCreated,
    dateRead: row.dateRead ?? null,
    dateDelivered: row.dateDelivered ?? null,
    isFromMe: row.isFromMe,
    sender: row.sender ?? null,
    attachments: attachments.map((a) => ({
      guid: a.guid,
      mimeType: a.mimeType ?? null,
      filename: a.filename ?? a.imessage?.transferName ?? null,
      width: a.width ?? null,
      height: a.height ?? null,
      totalBytes: a.totalBytes ?? null,
      thumbUrl: a.thumbUrl,
      ...(a.imessage ? { onMac: a.imessage.isOnDisk } : {}),
      originalUrl: a.originalUrl,
    })),
    mentions: row.mentions,
    reactions: row.reactions,
    replyToGuid: row.replyToGuid ?? null,
    replyToPreview: row.replyToPreview ?? null,
    replyToFromMe: row.replyToFromMe ?? null,
    isGroupEvent: row.isGroupEvent,
    edited: row.edited,
    retracted: row.retracted,
    clientKey: row.clientKey,
    // A pending send's row; one written before rows carried sendState is in flight until it errors.
    ...(isPendingGuid(row.guid) ? { sendState: row.sendState ?? (imessage?.error ? "failed" : "queued") } : {}),
    ...(imessage ? {
      imessage: {
        chatGuid: imessage.chatGuid, service: imessage.service, special: imessage.special ?? null, sendEffect: imessage.sendEffect ?? null,
        error: imessage.error, isAssociatedMessage: imessage.isAssociatedMessage, ...(imessage.isSpam !== undefined ? { isSpam: imessage.isSpam } : {}),
      },
    } : {}),
  };
}

export function attachmentSource(attachment: AttachmentSummary, fallback: string, thumbnail = false): string {
  return (thumbnail ? attachment.thumbUrl ?? attachment.originalUrl : attachment.originalUrl) ?? fallback;
}

export function scheduledToScheduled(row: ConvexScheduled, chats: readonly ChatSummary[]): ScheduledMessage {
  return {
    id: row.bbId,
    ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    chatGuid: row.chatGuid,
    chatName: chats.find((c) => c.conversationId === row.conversationId)?.displayName ?? row.chatGuid,
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
  const settledKeys = new Set(local.filter((m) => m.clientKey && !isPendingGuid(m.guid)).map((m) => m.clientKey));
  const remoteGuids = new Set(remote.map((m) => m.guid));
  const merged = remote.filter((m) => !(isPendingGuid(m.guid) && m.clientKey && settledKeys.has(m.clientKey) &&
    local.some((own) => own.clientKey === m.clientKey && remoteGuids.has(own.guid)))).map((m) => {
    const own = byGuid.get(m.guid) ?? (m.clientKey ? byKey.get(m.clientKey) : undefined);
    if (own) claimed.add(own);
    // A retry sends the bubble again under a new key, so the old send's row is stale until Convex replaces it.
    if (own && isPendingGuid(m.guid) && m.clientKey && own.clientKey !== m.clientKey) return own;
    // A pending send's row keeps the local bubble's identity, so it never remounts.
    return own?.clientKey ? { ...m, guid: isPendingGuid(m.guid) ? own.guid : m.guid, clientKey: own.clientKey } : m;
  });
  return sortThread([...merged, ...local.filter((m) => !claimed.has(m) && (m.sendState || m.clientKey))]);
}
