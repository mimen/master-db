import type { MentionAnnotation } from "./mentions";

export type StateFilter = "all" | "unread" | "unresponded" | "waiting" | "archived";
export type TypeFilter = "all" | "dm" | "group" | "unknown";

export interface Participant {
  address: string;
  name: string | null;
}

export interface AttachmentSummary {
  guid: string;
  mimeType: string | null;
  filename: string | null;
  width: number | null;
  height: number | null;
  totalBytes: number | null;
}

export interface Reaction {
  /** e.g. "love" | "like" | "dislike" | "laugh" | "emphasize" | "question" | emoji */
  type: string;
  isFromMe: boolean;
  senderName: string | null;
  senderAddress: string | null;
}

/** Rich cards for non-plain message payloads (contact card, location, etc.). */
export type SpecialContent =
  | { kind: "contact"; name: string | null }
  | { kind: "location" }
  | { kind: "apple-cash" }
  | { kind: "poll" }
  | { kind: "unknown"; label: string };

export interface Message {
  guid: string;
  chatGuid: string;
  text: string;
  /** Epoch ms. */
  dateCreated: number;
  dateRead: number | null;
  dateDelivered: number | null;
  isFromMe: boolean;
  /** "SMS" for green-bubble messages, "iMessage" otherwise. */
  service: "iMessage" | "SMS";
  sender: Participant | null;
  attachments: AttachmentSummary[];
  /** Real iMessage mention ranges decoded from attributedBody, when available. */
  mentions?: MentionAnnotation[];
  /** Non-plain payload rendered as a card (vCard, location, Apple Cash…). */
  special: SpecialContent | null;
  /** Apple expressive send style, e.g. "com.apple.MobileSMS.expressivesend.impact". */
  sendEffect: string | null;
  reactions: Reaction[];
  /** GUID of the message this one replies to (threaded reply), if any. */
  replyToGuid: string | null;
  /** Preview of the replied-to message, resolved server-side when available. */
  replyToPreview: string | null;
  /** Whether this is an associated message (for example, a tapback). */
  isAssociatedMessage?: boolean;
  /** Whether the replied-to message was sent by me (null when unresolved). */
  replyToFromMe: boolean | null;
  isGroupEvent: boolean;
  /** Apple's junk classification for this message, when supplied by BlueBubbles. */
  isSpam?: boolean;
  error: number;
  edited: boolean;
  retracted: boolean;
  /** Client-only optimistic-send states; never set by the server. */
  pending?: boolean;
  failed?: boolean;
}

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

export interface ChatFlags {
  archived: boolean;
  unresponded: boolean;
  waiting: boolean;
  unread: boolean;
  mutedUnresponded: boolean;
  pinned: boolean;
}

export interface ChatSummary {
  guid: string;
  displayName: string;
  isGroup: boolean;
  /** True when at least one participant matches a contact. */
  known: boolean;
  /** False when contact classification is temporarily unavailable; absent means available. */
  contactsAvailable?: boolean;
  /** Last message was flagged by Apple's junk detection. */
  isSpam: boolean;
  participants: Participant[];
  lastMessage: {
    guid: string;
    text: string;
    dateCreated: number;
    isFromMe: boolean;
    senderName: string | null;
    hasAttachments: boolean;
  } | null;
  unreadCount: number;
  /** Epoch ms of the oldest genuine unread inbound message, or null when unavailable. */
  firstUnreadAt?: number | null;
  flags: ChatFlags;
  /**
   * Deduped, lowercased name terms (display, first, last, nickname,
   * organization…) drawn from every participant's Identity Mirror record —
   * lets the ⌘K palette match this conversation by ANY name a participant
   * has ever gone by, not just displayName/participant.name. [] when the
   * mirror has nothing for these participants.
   */
  searchNames?: string[];
  /**
   * The private CRM layer's view of this conversation — favorite/priority/
   * tags/event links, sourced from Convex (never Apple/Airtable). Absent
   * means "nothing set," not "explicitly cleared."
   *
   * INHERITANCE RULE (see server/map.ts's mapChat): a GROUP chat's `crm`
   * comes from its OWN chat_crm/tags/event_links rows (chat_guid-keyed). A
   * DM has no CRM of its own — its `crm` is INHERITED from the linked
   * person's CRM (person_id-keyed), so favoriting/prioritizing/tagging a
   * contact and seeing it on their DM are the same fact, not two copies that
   * can drift. One source of truth per conversation either way.
   */
  crm?: {
    is_favorite?: boolean;
    /** P1–P5, one = highest — same convention as Convex's people.priority
     * and chat_crm.priority (see those schemas' docstrings). NOT inverted,
     * unlike Todoist's API. */
    priority?: number;
    tags?: string[];
    events?: Array<{ id: string; name: string }>;
  };
}

export type StateCounts = Record<StateFilter, number>;

export interface Contact {
  address: string;
  name: string;
  /** From the Identity Mirror's per-person CRM (Convex-native, never Apple/
   * Airtable) — absent for ContactBook-only hits (Apple contacts not yet
   * synced into Convex), which simply have no favorite concept to report. */
  is_favorite?: boolean;
}

export interface SendTextRequest {
  text: string;
  replyToGuid?: string;
  replyToPart?: number;
  mentions?: MentionAnnotation[];
}

export interface GalleryItem {
  guid: string;
  mimeType: string | null;
  filename: string | null;
  isImage: boolean;
  isVideo: boolean;
  dateCreated: number;
}

export type ScheduledMessageStatus =
  | "pending"
  | "in-progress"
  | "complete"
  | "failed"
  | "interrupted"
  | "expired";

export interface ScheduledMessage {
  id: number;
  chatGuid: string;
  chatName: string;
  text: string;
  /** Epoch ms when it will send. */
  sendAt: number;
  status: ScheduledMessageStatus;
  error: string | null;
  sentAt: number | null;
}

export interface NewChatRequest {
  addresses: string[];
  text: string;
}

export interface ReactRequest {
  chatGuid: string;
  reaction: string;
  remove?: boolean;
  partIndex?: number;
}

export type TranscriptState =
  | { state: "not-requested" }
  | { state: "working" }
  | { state: "ready"; text: string }
  | { state: "unavailable"; detail: string }
  | { state: "failed"; error: string };

// ------------------------------------------------------------------------ AI

/** Reported by /api/ai/status so the client can hide surfaces it cannot use. */
export interface AiStatus {
  /** Fast lane reachable — gateway key present. */
  suggestions: boolean;
  /** Harness lane reachable — ccs present with automation provenance. */
  shadow: boolean;
  /** Human-readable reason when `shadow` is false. */
  shadowDetail: string | null;
}

export interface ReplySuggestions {
  suggestions: string[];
  /** Guid of the last message when these were generated. */
  basedOnMessageGuid: string | null;
  /** True when newer messages have arrived since generation. */
  stale: boolean;
  generatedAt: number;
}

export interface ContactSuggestion {
  name: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface ShadowMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

export type ServerEvent =
  | { kind: "new-message"; chatGuid: string; message: Message }
  | { kind: "updated-message"; chatGuid: string; message: Message }
  | { kind: "reaction"; chatGuid: string; targetGuid: string; reaction: Reaction; remove: boolean }
  | { kind: "chats-changed" }
  | { kind: "typing"; chatGuid: string; display: boolean };
