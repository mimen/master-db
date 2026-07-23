import type { BBChat, BBMessage } from "./bb-types";
import type { ChatSummary, Message, Participant, Reaction, SpecialContent } from "../shared/types";
import type { ChatState } from "../shared/chat-state";
import { computeFlags } from "../shared/chat-state";
import { formatAddress } from "../shared/address";
import type { ContactBook } from "./contacts";

/** SMS (green bubble) messages come over a non-iMessage service. */
function messageService(m: BBMessage): "iMessage" | "SMS" {
  const svc = (m.handle?.service ?? "").toUpperCase();
  return svc === "SMS" || svc === "RCS" ? "SMS" : "iMessage";
}

/** Detects rich (non-plain-text) payloads by their app balloon bundle id. */
function specialContent(m: BBMessage): SpecialContent | null {
  const bundle = m.balloonBundleId ?? null;
  const hasVcard = (m.attachments ?? []).some(
    (a) => a.uti === "public.vcard" || /\.vcf$/i.test(a.transferName ?? ""),
  );
  if (hasVcard) {
    return { kind: "contact", name: (m.attachments?.[0]?.transferName ?? "").replace(/\.vcf$/i, "") || null };
  }
  if (!bundle) return null;
  if (bundle.includes("PassbookUIService") || bundle.includes("ApplePay")) return { kind: "apple-cash" };
  if (bundle.includes("MapsToday") || bundle.includes("Handles.Location")) return { kind: "location" };
  if (bundle.includes("SharedPoll") || bundle.includes("messages.poll")) return { kind: "poll" };
  // Rich-link balloons (URLBalloonProvider: Maps places, App Store, Music,
  // shared web pages…) carry their URL in the text — let the normal
  // link-preview path render them instead of a generic "App Message" card.
  if (bundle.includes("URLBalloonProvider") && /https?:\/\//.test(m.text ?? "")) return null;
  const label = bundle.split(".").filter(Boolean).pop() ?? "App message";
  return { kind: "unknown", label };
}

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

/**
 * Live-event view of a tapback: which message it targets and the reaction to
 * add or remove. The thread builder folds these on reload; this powers the
 * same folding in realtime so the client never renders a "Loved …" bubble.
 */
export function tapbackReactionEvent(
  m: BBMessage,
  contacts: ContactBook,
): { targetGuid: string; reaction: Reaction; remove: boolean } | null {
  if (!isTapback(m) || !m.associatedMessageGuid) return null;
  const value = m.associatedMessageType;
  let type: string | null = null;
  let remove = false;
  if (typeof value === "number") {
    if (value >= 2000 && value <= 2005) type = TAPBACK_NAMES[value - 2000] ?? null;
    else if (value >= 3000 && value <= 3005) {
      type = TAPBACK_NAMES[value - 3000] ?? null;
      remove = true;
    }
  } else if (typeof value === "string") {
    remove = value.startsWith("-");
    const raw = remove ? value.slice(1) : value;
    type = TAPBACK_NAMES.includes(raw as (typeof TAPBACK_NAMES)[number]) ? raw : null;
  }
  if (!type) return null;
  return {
    targetGuid: stripPartPrefix(m.associatedMessageGuid),
    remove,
    reaction: {
      type,
      isFromMe: m.isFromMe === true,
      senderName:
        m.isFromMe === true
          ? null
          : m.handle?.address
            ? contacts.lookup(m.handle.address)
            : null,
      senderAddress: m.handle?.address ?? null,
    },
  };
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
    service: messageService(m),
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
    special: specialContent(m),
    sendEffect: m.expressiveSendStyleId ?? null,
    reactions: [],
    // Only threadOriginatorGuid marks a real inline reply; Apple sets
    // replyToGuid on ordinary consecutive messages too.
    replyToGuid: m.threadOriginatorGuid ?? null,
    replyToPreview: null,
    isAssociatedMessage: isTapback(m),
    replyToFromMe: null,
    isGroupEvent: isGroupEvent(m),
    isSpam: m.isSpam === true,
    error: m.error ?? 0,
    edited: Boolean(m.dateEdited),
    retracted: Boolean(m.dateRetracted),
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
    .filter((m) => !isTapback(m) && !m.dateRetracted)
    .map((m) => mapMessage(m, chatGuid, contacts))
    .sort((a, b) => a.dateCreated - b.dateCreated);

  const byGuid = new Map(messages.map((m) => [m.guid, m]));
  for (const message of messages) {
    message.reactions = tapbacks.get(message.guid) ?? [];
    if (message.replyToGuid) {
      const target = byGuid.get(stripPartPrefix(message.replyToGuid));
      if (target) {
        message.replyToPreview = target.text.slice(0, 120) || (target.attachments.length > 0 ? "Attachment" : "");
        message.replyToFromMe = target.isFromMe;
      }
    }
  }
  return messages;
}

function chatDisplayName(chat: BBChat, contacts: ContactBook): string {
  if (chat.displayName?.trim()) return chat.displayName.trim();
  const participants = chat.participants ?? [];
  const names = participants.map((p) => contacts.lookup(p.address) ?? formatAddress(p.address));
  if (names.length === 0) return chat.chatIdentifier ? formatAddress(chat.chatIdentifier) : chat.guid;
  if (names.length === 1) return names[0] ?? chat.guid;
  // Groups: Apple-style first names — "Marissa, Sarah & Mike". Formatted phones
  // and emails (anything with a digit, "@", or "(") stay whole, not split.
  const firsts = names.map((n) => (/[\d@(+]/.test(n) ? n : (n.split(/\s+/)[0] ?? n)));
  if (firsts.length <= 4) {
    return `${firsts.slice(0, -1).join(", ")} & ${firsts[firsts.length - 1]}`;
  }
  return `${firsts.slice(0, 3).join(", ")} +${firsts.length - 3}`;
}

export interface UnreadSummary {
  count: number;
  firstUnreadAt: number | null;
}

function isGenuineUnreadInbound(m: BBMessage): boolean {
  return (
    m.isFromMe !== true &&
    !m.dateRead &&
    !m.dateRetracted &&
    (m.dateCreated ?? 0) > 0 &&
    !isGroupEvent(m) &&
    !isTapback(m)
  );
}

export function mapChat(
  chat: BBChat,
  state: ChatState | undefined,
  contacts: ContactBook,
  scannedUnread?: UnreadSummary,
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
              ? (contacts.lookup(last.handle.address) ?? formatAddress(last.handle.address))
              : null,
        hasAttachments: (last.attachments ?? []).length > 0,
      }
    : null;
  // The scan is authoritative when available. A genuine last unread message
  // still provides a safe fallback if BlueBubbles' global query failed.
  const fallbackUnreadAt = last && isGenuineUnreadInbound(last) ? last.dateCreated ?? 0 : null;
  const unreadCount = Math.max(scannedUnread?.count ?? 0, fallbackUnreadAt === null ? 0 : 1);
  const firstUnreadAt = scannedUnread?.count ? scannedUnread.firstUnreadAt : fallbackUnreadAt;
  const flagInput = last
    ? { guid: last.guid, dateCreated: last.dateCreated ?? 0, isFromMe: last.isFromMe === true }
    : null;
  const participants = (chat.participants ?? []).map((p) => ({
    address: p.address,
    name: contacts.lookup(p.address),
  }));
  return {
    guid: chat.guid,
    displayName: chatDisplayName(chat, contacts),
    isGroup,
    known: participants.some((p) => p.name !== null),
    contactsAvailable: contacts.available,
    isSpam: last?.isSpam === true,
    participants,
    lastMessage: lastSummary,
    unreadCount,
    firstUnreadAt,
    flags: computeFlags(state, flagInput, unreadCount),
  };
}

const TAPBACK_VERBS: Record<string, string> = {
  love: "Loved a message",
  like: "Liked a message",
  dislike: "Disliked a message",
  laugh: "Laughed at a message",
  emphasize: "Emphasized a message",
  question: "Questioned a message",
};

function summarizeLast(m: BBMessage): string {
  if (isTapback(m)) {
    const type = tapbackType(m.associatedMessageType);
    return type ? (TAPBACK_VERBS[type] ?? `Reacted ${type}`) : "Removed a reaction";
  }
  const text = cleanText(m);
  if (text) return text;
  if ((m.attachments ?? []).length > 0) return "Attachment";
  if (isGroupEvent(m)) return m.groupTitle ? `Named the group "${m.groupTitle}"` : "Group updated";
  return "";
}
