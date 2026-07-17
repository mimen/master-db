export type StateFilter = "all" | "unread" | "unresponded" | "waiting" | "archived";
export type TypeFilter = "all" | "dm" | "group";

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

export interface Message {
  guid: string;
  chatGuid: string;
  text: string;
  /** Epoch ms. */
  dateCreated: number;
  dateRead: number | null;
  dateDelivered: number | null;
  isFromMe: boolean;
  sender: Participant | null;
  attachments: AttachmentSummary[];
  reactions: Reaction[];
  /** GUID of the message this one replies to (threaded reply), if any. */
  replyToGuid: string | null;
  /** Preview of the replied-to message, resolved server-side when available. */
  replyToPreview: string | null;
  /** Whether the replied-to message was sent by me (null when unresolved). */
  replyToFromMe: boolean | null;
  isGroupEvent: boolean;
  error: number;
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
}

export interface ChatSummary {
  guid: string;
  displayName: string;
  isGroup: boolean;
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
  flags: ChatFlags;
}

export interface Contact {
  address: string;
  name: string;
}

export interface SendTextRequest {
  text: string;
  replyToGuid?: string;
  replyToPart?: number;
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
