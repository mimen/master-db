import type { BBAttachment, BBChat, BBHandle, BBMessage } from "./bb-types";
import type { ChatSummary, Message, Participant, Reaction, SpecialContent } from "../shared/types";
import type { MentionAnnotation } from "../shared/mentions";
import type { ChatState } from "../shared/chat-state";
import { computeFlags } from "../shared/chat-state";
import { formatAddress } from "../shared/address";
import type { CrmData, NameSource } from "./name-resolver";

/** SMS (green bubble) messages come over a non-iMessage service. */
function messageService(
  m: BBMessage,
  chatGuid?: string,
  sourceChatGuid?: string,
): "iMessage" | "SMS" {
  const rawChatGuid = sourceChatGuid ?? m.chats?.[0]?.guid ?? chatGuid;
  const chatService = rawChatGuid?.split(";", 1)[0]?.toUpperCase();
  if (chatService === "SMS" || chatService === "RCS") return "SMS";
  if (chatService === "IMESSAGE") return "iMessage";
  const handleService = (m.handle?.service ?? "").toUpperCase();
  return handleService === "SMS" || handleService === "RCS" ? "SMS" : "iMessage";
}

const ON_DISK = 5;

/**
 * Messages often carry one photo twice: a HEIC original beside its
 * "<name>.HEIC.jpeg" rendition, or an RCS/SMS copy that never downloaded
 * beside the one that did. Keep one per photo, preferring a copy on disk,
 * then the JPEG. Distinct same-name images (both on disk) all stay.
 */
export function visibleAttachments(attachments: readonly BBAttachment[]): BBAttachment[] {
  const shown = attachments.filter((a) => a.guid && !a.hideAttachment);
  const groups = new Map<string, BBAttachment[]>();
  for (const a of shown) {
    const key = (a.transferName ?? a.guid).toLowerCase().replace(/\.(heic|heif)\.jpe?g$/, ".$1");
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const dropped = new Set<BBAttachment>();
  const rank = (a: BBAttachment) =>
    (a.transferState === ON_DISK ? 2 : 0) + (a.mimeType === "image/jpeg" ? 1 : 0);
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const keep = group.reduce((best, a) =>
      rank(a) > rank(best) || (rank(a) === rank(best) && (a.width ?? 0) > (best.width ?? 0)) ? a : best);
    const onePhoto = /\.(heic|heif)$/.test(key);
    for (const a of group) {
      if (a !== keep && (onePhoto || a.transferState !== ON_DISK)) dropped.add(a);
    }
  }
  return shown.filter((a) => !dropped.has(a));
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
const CUSTOM_EMOJI_TAPBACK = 6;
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

interface Tapback {
  type: string;
  emoji?: string;
  remove: boolean;
}

/**
 * BlueBubbles omits chat.db's associated_message_emoji, so the emoji comes
 * from the synthesized text ("Reacted 😍 to “…”", "Removed ❤️ from “…”",
 * localized variants). Only the part before the quoted target is scanned so
 * an emoji inside the quote is never picked.
 */
function tapbackEmoji(m: BBMessage): string | undefined {
  const body = Array.isArray(m.attributedBody) ? m.attributedBody[0] : m.attributedBody;
  const text = m.text ?? body?.string ?? "";
  const prefix = text.split("“")[0] ?? "";
  for (const { segment } of graphemes.segment(prefix)) {
    if (PICTOGRAPH.test(segment)) return segment;
  }
  return undefined;
}

export function parseTapback(m: BBMessage): Tapback | null {
  if (!isTapback(m)) return null;
  // BlueBubbles names the classic tapbacks ("love", "-love") and stringifies
  // every other code, so custom emoji arrive as "2006" / "3006".
  const raw = m.associatedMessageType;
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value === "number") {
    const remove = value >= 3000;
    const index = value - (remove ? 3000 : 2000);
    if (index === CUSTOM_EMOJI_TAPBACK) {
      const emoji = tapbackEmoji(m);
      return emoji ? { type: "emoji", emoji, remove } : { type: "emoji", remove };
    }
    const type = TAPBACK_NAMES[index];
    return type ? { type, remove } : null;
  }
  if (typeof value !== "string") return null;
  const remove = value.startsWith("-");
  const name = remove ? value.slice(1) : value;
  return TAPBACK_NAMES.includes(name as (typeof TAPBACK_NAMES)[number]) ? { type: name, remove } : null;
}

/** Strips the "p:0/" / "bp:0/" part prefix from an associated message GUID. */
function stripPartPrefix(guid: string): string {
  return guid.replace(/^b?p:\d+\//, "");
}

function isTapback(m: BBMessage): boolean {
  return Boolean(m.associatedMessageGuid && m.associatedMessageType);
}

function reactionOf(tapback: Tapback, isFromMe: boolean, who: Participant | null): Reaction {
  return {
    type: tapback.type,
    ...(tapback.emoji ? { emoji: tapback.emoji } : {}),
    isFromMe,
    senderName: who?.name ?? null,
    senderAddress: who?.address ?? null,
  };
}

/** `a` is the incoming reaction; one without a parsed emoji matches any emoji from the same sender. */
function sameReaction(a: Reaction, b: Reaction): boolean {
  const sameSender = a.isFromMe ? b.isFromMe : !b.isFromMe && a.senderAddress === b.senderAddress;
  return sameSender && a.type === b.type && (!a.emoji || a.emoji === b.emoji);
}

/**
 * Live-event view of a tapback: which message it targets and the reaction to
 * add or remove. The thread builder folds these on reload; this powers the
 * same folding in realtime so the client never renders a "Loved …" bubble.
 */
export function tapbackReactionEvent(
  m: BBMessage,
  contacts: NameSource,
  participants: readonly BBHandle[] = [],
): { targetGuid: string; reaction: Reaction; remove: boolean } | null {
  const tapback = parseTapback(m);
  if (!tapback || !m.associatedMessageGuid) return null;
  return {
    targetGuid: stripPartPrefix(m.associatedMessageGuid),
    remove: tapback.remove,
    reaction: reactionOf(tapback, m.isFromMe === true, sender(m, contacts, participants)),
  };
}

function isGroupEvent(m: BBMessage): boolean {
  return (m.itemType ?? 0) !== 0 || (m.groupActionType ?? 0) !== 0;
}

function cleanText(m: BBMessage): string {
  const bodies = Array.isArray(m.attributedBody) ? m.attributedBody : [m.attributedBody];
  const decoded = bodies.find((body) => body?.string)?.string ?? "";
  const text = (m.text ?? decoded).replaceAll("￼", "").trim();
  const subject = (m.subject ?? "").trim();
  if (subject && text) return `${subject}\n${text}`;
  return subject || text;
}

function messageMentions(m: BBMessage, text: string): MentionAnnotation[] {
  const mentions: MentionAnnotation[] = [];
  const bodies = Array.isArray(m.attributedBody)
    ? m.attributedBody
    : m.attributedBody
      ? [m.attributedBody]
      : [];
  for (const body of bodies) {
    const leadingTrim = body.string.length - body.string.trimStart().length;
    if (body.string.trim() !== text) continue;
    for (const run of body.runs ?? []) {
      const address = run.attributes?.__kIMMentionConfirmedMention?.trim();
      if (!address) continue;
      const [rawStart, length] = run.range;
      const start = rawStart - leadingTrim;
      if (start < 0 || length <= 0 || start + length > text.length) continue;
      mentions.push({ start, length, address });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

function sender(
  m: BBMessage,
  contacts: NameSource,
  participants: readonly BBHandle[] = [],
): Participant | null {
  if (m.isFromMe) return null;
  // BlueBubbles' chat-list query joins lastMessage without lastMessage.handle.
  // handleId still points at a participant's originalROWID, so recover the
  // sender from the chat participants instead of dropping group attribution.
  const participantAddress =
    typeof m.handleId === "number" && m.handleId > 0
      ? participants.find((participant) => participant.originalROWID === m.handleId)?.address
      : undefined;
  const address = m.handle?.address ?? participantAddress;
  if (!address) return null;
  return { address, name: contacts.lookup(address) };
}

export function mapMessage(
  m: BBMessage,
  chatGuid: string,
  contacts: NameSource,
  participants: readonly BBHandle[] = [],
  sourceChatGuid?: string,
): Message {
  const text = isTapback(m) ? summarizeLast(m) : cleanText(m);
  return {
    guid: m.guid,
    chatGuid,
    // Tapbacks carry Apple's raw `Loved "whole quoted text"` — summarize to the
    // verb ("Loved a message") so the live sidebar preview matches a reload.
    // Thread rows are unaffected: buildThread filters tapbacks before mapping.
    text,
    dateCreated: m.dateCreated ?? 0,
    dateRead: m.dateRead ?? null,
    dateDelivered: m.dateDelivered ?? null,
    isFromMe: m.isFromMe === true,
    service: messageService(m, chatGuid, sourceChatGuid),
    sender: sender(m, contacts, participants),
    attachments: visibleAttachments(m.attachments ?? [])
      .map((a) => ({
        guid: a.guid,
        mimeType: a.mimeType ?? null,
        filename: a.transferName ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        totalBytes: a.totalBytes ?? null,
      })),
    mentions: messageMentions(m, text),
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
    retracted: isRetracted(m),
  };
}

/** BlueBubbles leaves dateRetracted unset on an unsend; it reports an edit that emptied the message. */
function isRetracted(m: BBMessage): boolean {
  if (m.dateRetracted) return true;
  return Boolean(m.dateEdited) && !m.text && !m.attachments?.length;
}

/**
 * Converts a raw DESC message window into ascending, normal messages with
 * tapbacks folded into `reactions` and reply previews resolved in-window.
 */
export function buildThread(
  raw: BBMessage[],
  chatGuid: string,
  contacts: NameSource,
): Message[] {
  const tapbacks = new Map<string, Reaction[]>();
  const chronological = raw.filter(isTapback).sort((a, b) => (a.dateCreated ?? 0) - (b.dateCreated ?? 0));
  for (const m of chronological) {
    const tapback = parseTapback(m);
    if (!tapback || !m.associatedMessageGuid) continue;
    const target = stripPartPrefix(m.associatedMessageGuid);
    const address = m.handle?.address ?? null;
    const reaction = reactionOf(
      tapback,
      m.isFromMe === true,
      address ? { address, name: contacts.lookup(address) } : null,
    );
    const rest = (tapbacks.get(target) ?? []).filter((r) => !sameReaction(reaction, r));
    tapbacks.set(target, tapback.remove ? rest : [...rest, reaction]);
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

function chatDisplayName(chat: BBChat, contacts: NameSource): string {
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

/**
 * Reduces a raw CRM projection (from the Identity Mirror — either a chat's
 * own or an inherited person's) to ChatSummary's wire shape, or `undefined`
 * when there's genuinely nothing to show. Two distinct "nothing" cases both
 * collapse to the same `undefined`: the mirror never resolved this
 * chat/person at all, AND the mirror resolved it but every field is unset —
 * a caller building a UI (favorite star, priority badge, tag chips) only
 * ever needs to ask "is there a `crm` object," never "which kind of empty."
 */
function normalizeCrm(raw: CrmData | undefined): ChatSummary["crm"] {
  if (!raw) return undefined;
  const tags = raw.tags && raw.tags.length > 0 ? raw.tags : undefined;
  const events = raw.events && raw.events.length > 0 ? raw.events : undefined;
  if (!raw.is_favorite && raw.priority === undefined && !tags && !events) return undefined;
  return { is_favorite: raw.is_favorite, priority: raw.priority, tags, events };
}

/**
 * The CRM inheritance rule (decided 2026-07-24, see
 * docs/plans/structured-names.html's "MEMBERSHIP ≠ OWNERSHIP"): a GROUP
 * chat's CRM is its OWN (chat_guid-keyed); a DM has none of its own — it
 * INHERITS the linked person's CRM, so favoriting/prioritizing/tagging a
 * contact shows up on their DM automatically, with one source of truth
 * rather than two copies that can drift. A DM with more than one raw
 * participant address (shouldn't happen — that would make it a group by the
 * caller's own `isGroup` check) or with none at all has nothing to inherit
 * from.
 */
function chatCrmField(
  chatGuid: string,
  isGroup: boolean,
  participants: readonly BBHandle[],
  contacts: NameSource,
): ChatSummary["crm"] {
  if (isGroup) return normalizeCrm(contacts.chatCrm(chatGuid));
  const only = participants.length === 1 ? participants[0] : undefined;
  if (!only?.address) return undefined;
  return normalizeCrm(contacts.personCrm(only.address));
}

export function mapChat(
  chat: BBChat,
  state: ChatState | undefined,
  contacts: NameSource,
  scannedUnread?: UnreadSummary,
): ChatSummary {
  const last = chat.lastMessage ?? null;
  const participants = chat.participants ?? [];
  const isGroup = chat.guid.includes(";+;") || participants.length > 1;
  const lastSender = last ? sender(last, contacts, participants) : null;
  const lastSummary = last
    ? {
        guid: last.guid,
        text: summarizeLast(last),
        dateCreated: last.dateCreated ?? 0,
        isFromMe: last.isFromMe === true,
        senderName: lastSender
          ? (lastSender.name ?? formatAddress(lastSender.address))
          : null,
        hasAttachments: (last.attachments ?? []).length > 0,
      }
    : null;
  // The scan is authoritative when available. A genuine last unread message
  // still provides a safe fallback if BlueBubbles' global query failed.
  const fallbackUnreadAt = last && isGenuineUnreadInbound(last) ? last.dateCreated ?? 0 : null;
  // A chat whose last message is mine is read: replying reads the thread.
  const lastFromMe = last?.isFromMe === true;
  const unreadCount = lastFromMe ? 0 : Math.max(scannedUnread?.count ?? 0, fallbackUnreadAt === null ? 0 : 1);
  const firstUnreadAt = lastFromMe ? null : scannedUnread?.count ? scannedUnread.firstUnreadAt : fallbackUnreadAt;
  const flagInput = last
    ? { guid: last.guid, dateCreated: last.dateCreated ?? 0, isFromMe: last.isFromMe === true }
    : null;
  const mappedParticipants = participants.map((p) => ({
    address: p.address,
    name: contacts.lookup(p.address),
  }));
  const searchNames = [...new Set(participants.flatMap((p) => contacts.searchTerms(p.address)))];
  return {
    guid: chat.guid,
    displayName: chatDisplayName(chat, contacts),
    isGroup,
    hasGroupPhoto: isGroup && Boolean(chat.properties?.[0]?.groupPhotoGuid),
    known: mappedParticipants.some((p) => p.name !== null),
    contactsAvailable: contacts.available,
    isSpam: last?.isSpam === true,
    participants: mappedParticipants,
    lastMessage: lastSummary,
    unreadCount,
    firstUnreadAt,
    flags: computeFlags(state, flagInput, unreadCount),
    searchNames,
    crm: chatCrmField(chat.guid, isGroup, participants, contacts),
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
    const tapback = parseTapback(m);
    if (!tapback || tapback.remove) return "Removed a reaction";
    if (tapback.emoji) return `Reacted ${tapback.emoji} to a message`;
    return TAPBACK_VERBS[tapback.type] ?? "Reacted to a message";
  }
  const text = cleanText(m);
  if (text) return text;
  if ((m.attachments ?? []).length > 0) return "Attachment";
  if (isGroupEvent(m)) return m.groupTitle ? `Named the group "${m.groupTitle}"` : "Group updated";
  return "";
}
