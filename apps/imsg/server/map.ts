import type { BBChat, BBMessage } from "./bb-types";
import type { ChatSummary, Message, Participant, Reaction } from "../shared/types";
import type { ChatState } from "./db";
import type { ContactBook } from "./contacts";
import { computeFlags } from "./filters";

const TAPBACK_NAMES = ["love", "like", "dislike", "laugh", "emphasize", "question"] as const;

/** Returns the tapback name for add-type reactions, null for non-tapbacks or removals. */
function tapbackType(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (value >= 2000 && value <= 2005) return TAPBACK_NAMES[value - 2000] ?? null;
    return null; // 3000s = removal
  }
  if (value.startsWith("-")) return null;
  return TAPBACK_NAMES.includes(value as (typeof TAPBACK_NAMES)[number]) ? value : null;
}

/** Strips the "p:0/" / "bp:0/" part prefix from an associated message GUID. */
function stripPartPrefix(guid: string): string {
  return guid.replace(/^b?p:\d+\//, "");
}

function isTapback(m: BBMessage): boolean {
  return Boolean(m.associatedMessageGuid && m.associatedMessageType);
}

function isGroupEvent(m: BBMessage): boolean {
  return (m.itemType ?? 0) !== 0 || (m.groupActionType ?? 0) !== 0;
}

function cleanText(m: BBMessage): string {
  const text = (m.text ?? "").replaceAll("￼", "").trim();
  const subject = (m.subject ?? "").trim();
  if (subject && text) return `${subject}\n${text}`;
  return subject || text;
}

function sender(m: BBMessage, contacts: ContactBook): Participant | null {
  if (m.isFromMe || !m.handle?.address) return null;
  return { address: m.handle.address, name: contacts.lookup(m.handle.address) };
}

export function mapMessage(m: BBMessage, chatGuid: string, contacts: ContactBook): Message {
  return {
    guid: m.guid,
    chatGuid,
    text: cleanText(m),
    dateCreated: m.dateCreated ?? 0,
    dateRead: m.dateRead ?? null,
    dateDelivered: m.dateDelivered ?? null,
    isFromMe: m.isFromMe === true,
    sender: sender(m, contacts),
    attachments: (m.attachments ?? [])
      .filter((a) => a.guid && !a.hideAttachment)
      .map((a) => ({
        guid: a.guid,
        mimeType: a.mimeType ?? null,
        filename: a.transferName ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        totalBytes: a.totalBytes ?? null,
      })),
    reactions: [],
    // Only threadOriginatorGuid marks a real inline reply; Apple sets
    // replyToGuid on ordinary consecutive messages too.
    replyToGuid: m.threadOriginatorGuid ?? null,
    replyToPreview: null,
    isGroupEvent: isGroupEvent(m),
    error: m.error ?? 0,
  };
}

/**
 * Converts a raw DESC message window into ascending, normal messages with
 * tapbacks folded into `reactions` and reply previews resolved in-window.
 */
export function buildThread(
  raw: BBMessage[],
  chatGuid: string,
  contacts: ContactBook,
): Message[] {
  const tapbacks = new Map<string, Reaction[]>();
  for (const m of raw) {
    if (!isTapback(m)) continue;
    const type = tapbackType(m.associatedMessageType);
    if (!type || !m.associatedMessageGuid) continue;
    const target = stripPartPrefix(m.associatedMessageGuid);
    const list = tapbacks.get(target) ?? [];
    list.push({
      type,
      isFromMe: m.isFromMe === true,
      senderName: m.handle?.address ? contacts.lookup(m.handle.address) : null,
      senderAddress: m.handle?.address ?? null,
    });
    tapbacks.set(target, list);
  }

  const messages = raw
    .filter((m) => !isTapback(m))
    .map((m) => mapMessage(m, chatGuid, contacts))
    .sort((a, b) => a.dateCreated - b.dateCreated);

  const byGuid = new Map(messages.map((m) => [m.guid, m]));
  for (const message of messages) {
    message.reactions = tapbacks.get(message.guid) ?? [];
    if (message.replyToGuid) {
      const target = byGuid.get(stripPartPrefix(message.replyToGuid));
      if (target) {
        message.replyToPreview = target.text.slice(0, 120) || (target.attachments.length > 0 ? "Attachment" : "");
      }
    }
  }
  return messages;
}

function chatDisplayName(chat: BBChat, contacts: ContactBook): string {
  if (chat.displayName?.trim()) return chat.displayName.trim();
  const names = (chat.participants ?? []).map(
    (p) => contacts.lookup(p.address) ?? p.address,
  );
  if (names.length === 0) return chat.chatIdentifier ?? chat.guid;
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

export function mapChat(
  chat: BBChat,
  state: ChatState | undefined,
  contacts: ContactBook,
  scannedUnread?: number,
): ChatSummary {
  const last = chat.lastMessage ?? null;
  const isGroup = chat.guid.includes(";+;") || (chat.participants ?? []).length > 1;
  const lastSummary = last
    ? {
        guid: last.guid,
        text: summarizeLast(last),
        dateCreated: last.dateCreated ?? 0,
        isFromMe: last.isFromMe === true,
        senderName:
          last.isFromMe === true
            ? null
            : last.handle?.address
              ? (contacts.lookup(last.handle.address) ?? last.handle.address)
              : null,
        hasAttachments: (last.attachments ?? []).length > 0,
      }
    : null;
  // The scanned count only covers the recent global window; the last-message
  // heuristic catches unread chats that fell outside it.
  const heuristic =
    last && last.isFromMe !== true && !last.dateRead && !isGroupEvent(last) && !isTapback(last)
      ? 1
      : 0;
  const unreadCount = Math.max(scannedUnread ?? 0, heuristic);
  const flagInput = last
    ? { guid: last.guid, dateCreated: last.dateCreated ?? 0, isFromMe: last.isFromMe === true }
    : null;
  return {
    guid: chat.guid,
    displayName: chatDisplayName(chat, contacts),
    isGroup,
    participants: (chat.participants ?? []).map((p) => ({
      address: p.address,
      name: contacts.lookup(p.address),
    })),
    lastMessage: lastSummary,
    unreadCount,
    flags: computeFlags(state, flagInput, unreadCount),
  };
}

function summarizeLast(m: BBMessage): string {
  if (isTapback(m)) {
    const type = tapbackType(m.associatedMessageType);
    return type ? `Reacted ${type}` : "Removed a reaction";
  }
  const text = cleanText(m);
  if (text) return text;
  if ((m.attachments ?? []).length > 0) return "Attachment";
  if (isGroupEvent(m)) return m.groupTitle ? `Named the group "${m.groupTitle}"` : "Group updated";
  return "";
}
