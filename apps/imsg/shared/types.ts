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
}

export type StateCounts = Record<StateFilter, number>;

export interface Contact {
  address: string;
  name: string;
}

export interface SendTextRequest {
  text: string;
  replyToGuid?: string;
  replyToPart?: number;
}

export interface GalleryItem {
  guid: string;
  mimeType: string | null;
  filename: string | null;
  isImage: boolean;
  isVideo: boolean;
  dateCreated: number;
}

export interface ScheduledMessage {
  id: string;
  chatGuid: string;
  chatName: string;
  text: string;
  /** Epoch ms when it will send. */
  sendAt: number;
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

export type ServerEvent =
  | { kind: "new-message"; chatGuid: string; message: Message }
  | { kind: "updated-message"; chatGuid: string; message: Message }
  | { kind: "chats-changed" }
  | { kind: "typing"; chatGuid: string; display: boolean };
