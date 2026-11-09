import type { GenericId } from "convex/values";
import type { AgentAttention } from "./agent-attention";
import type { MentionAnnotation } from "./mentions";
import type { PendingSendState } from "./pending-send";

export type StateFilter = "today" | "all" | "unread" | "unresponded" | "waiting" | "drafts" | "agents" | "settled";

/** The line an agent chat shows in lists: its open question, draft, reply, latest thought, or error. */
export interface AgentPreview {
  kind: "question" | "draft" | "reply" | "thinking" | "error";
  text: string;
}
/** One axis, ordered as the filter rail renders it. See matchesFilters for what
 * each lens does with screened conversations. */
export type TypeFilter = "all" | "known" | "dm" | "group" | "unknown";

export interface Participant {
  address: string;
  name: string | null;
  /** The contact photo the conversation list already resolved; absent when unknown. */
  photoUrl?: string | null;
}

export interface AttachmentSummary {
  guid: string;
  thumbUrl?: string | null;
  originalUrl?: string | null;
  mimeType: string | null;
  filename: string | null;
  width: number | null;
  height: number | null;
  totalBytes: number | null;
  /** False when Messages never downloaded the file on the Mac; absent means unknown. */
  onMac?: boolean;
}

export interface Reaction {
  /** The reaction's identity on its platform, and what a react command sends: an iMessage tapback name ("love"), or `emoji:` and an emoji tapback's emoji ("emoji:😍"). */
  key: string;
  /** How it looks, when it is a Unicode emoji; absent when it could not be read. */
  emoji?: string;
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

/** The platforms Comma mirrors. */
export type Platform = "imessage" | "slack" | "gmail";

/** A conversation's shape: one person, a group, a workspace channel, or an email thread. */
export type ConversationKind = "dm" | "group" | "channel" | "thread" | "emailThread";

/** An account's Convex id: one signed-in identity on a platform. */
export type AccountId = GenericId<"comma_accounts">;

/** What only an iMessage message has. */
export interface IMessageDetails {
  chatGuid: string;
  /** "SMS" for green-bubble messages, "iMessage" otherwise. */
  service: "iMessage" | "SMS";
  /** Non-plain payload rendered as a card (vCard, location, Apple Cash…). */
  special: SpecialContent | null;
  /** Apple expressive send style, e.g. "com.apple.MobileSMS.expressivesend.impact". */
  sendEffect: string | null;
  /** BlueBubbles' send error code; 0 when none. */
  error: number;
  /** Apple's junk classification for this message, when supplied by BlueBubbles. */
  isSpam?: boolean;
  /** An associated message, such as a tapback. */
  isAssociatedMessage?: boolean;
}

/** A message on any platform; its platform's own fields sit under that platform's key. */
export interface Message {
  guid: string;
  platform: Platform;
  text: string;
  /** A Slack message that starts a thread Comma holds: that thread's conversation and its replies. */
  thread?: { conversationId: ConversationId; replyCount: number };
  /** Epoch ms. */
  dateCreated: number;
  dateRead: number | null;
  dateDelivered: number | null;
  isFromMe: boolean;
  sender: Participant | null;
  attachments: AttachmentSummary[];
  /** Mention ranges, when the platform carries them. */
  mentions?: MentionAnnotation[];
  reactions: Reaction[];
  /** GUID of the message this one replies to (threaded reply), if any. */
  replyToGuid: string | null;
  /** Preview of the replied-to message, resolved server-side when available. */
  replyToPreview: string | null;
  /** Whether the replied-to message was sent by me (null when unresolved). */
  replyToFromMe: boolean | null;
  isGroupEvent: boolean;
  edited: boolean;
  retracted: boolean;
  /** Set only on a send that has not landed yet; see pending-send.ts. */
  sendState?: PendingSendState;
  /** The outbox key of the send this message is or settled from, which also keeps its row's identity. */
  clientKey?: string;
  imessage?: IMessageDetails;
}

/**
 * A message as the bridge's BlueBubbles mapper and the command results carry it: iMessage's flat shape. Clients
 * turn one into a Message with fromBridgeMessage (shared/imessage.ts).
 */
export interface BridgeMessage {
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
  /** Set only on a send that has not landed yet; see pending-send.ts. */
  sendState?: PendingSendState;
  /** The outbox key of the send this message is or settled from, which also keeps its row's identity. */
  clientKey?: string;
}

export interface ChatFlags {
  unresponded: boolean;
  waiting: boolean;
  unread: boolean;
  mutedUnresponded: boolean;
  pinned: boolean;
}

/** Why a snoozed conversation came back: its time came, or someone wrote first. */
export type SnoozeReturnReason = "time" | "message";

/**
 * Comma-only deferrals. Later takes a conversation out of every queue until `snoozedUntil`; it comes back early on a
 * new inbound message. A conversation that came back, or whose follow-up fell due with no reply, needs the user again.
 */
export interface ChatLater {
  snoozedUntil?: number;
  returned?: { reason: SnoozeReturnReason; until: number; at: number };
  /** Remind if no reply by `at`; `since` is the user's own message it waits on. */
  followUp?: { at: number; since: number; due: boolean };
}

/** A conversation's Convex id: what the app selects, routes, keys and commands by. */
export type ConversationId = GenericId<"comma_conversations">;

/**
 * Where a conversation's commands go: its platform and account, and that platform's own thread. Convex stamps the
 * real route on each command; this is the client's copy, for what a route can do. `accountId` is null until the
 * accounts backfill reaches the conversation.
 */
export type ChatRoute = {
  platform: "imessage";
  accountId: AccountId | null;
  /** The chat GUID the conversation sends through. Parse it only through shared/imessage.ts. */
  imessage: { chatGuid: string };
} | {
  platform: "slack";
  accountId: AccountId;
  /** The Slack channel, DM or group DM, and the thread when the conversation is one thread inside a channel. */
  slack: { channel: string; threadTs?: string };
} | {
  platform: "gmail";
  accountId: AccountId;
  gmail: { threadId: string };
};

export interface ChatSummary {
  conversationId: ConversationId;
  route: ChatRoute;
  displayName: string;
  kind: ConversationKind;
  /** A Slack thread's: the DM, group DM or channel Comma holds it in, and how many replies it has. */
  thread?: { parentId?: ConversationId; replyCount: number };
  /** Derived from `kind`: every kind but a dm. */
  isGroup: boolean;
  /** Whether BlueBubbles reports an uploaded group photo for this chat. */
  hasGroupPhoto?: boolean;
  groupPhotoUrl?: string | null;
  /** True when at least one participant matches a contact. */
  known: boolean;
  /** False when contact classification is temporarily unavailable; absent means available. */
  contactsAvailable?: boolean;
  /** Last message was flagged by Apple's junk detection. */
  isSpam: boolean;
  /** An email thread sent to a list: newsletters, notifications, promotions. */
  bulk?: boolean;
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
  later?: ChatLater;
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
   * comes from its OWN chat_crm/tags/event_links rows (keyed by conversation). A
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
  /** What sits in this conversation's composer, unsent: the user's own text or an agent-prepared draft. */
  draft?: {
    source: "user" | "agent";
    text: string;
    note?: string;
    attachmentCount: number;
    updatedAt: number;
  };
  /** The conversation's unsettled agent chats, summarized by the most urgent one. Absent when none. */
  agent?: {
    attention: Exclude<AgentAttention, "settled">;
    chatId: string;
    title: string;
    preview?: AgentPreview;
    openCount: number;
    activityAt: number;
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
  /** Absent until the bridge has mirrored the scheduled message's chat. */
  conversationId?: ConversationId;
  chatGuid: string;
  chatName: string;
  text: string;
  /** Epoch ms when it will send. */
  sendAt: number;
  status: ScheduledMessageStatus;
  error: string | null;
  sentAt: number | null;
}

export type TranscriptState =
  | { state: "not-requested" }
  | { state: "working" }
  | { state: "ready"; text: string }
  | { state: "unavailable"; detail: string }
  | { state: "failed"; error: string };

// ------------------------------------------------------------------------ AI

/** Mirrored through Convex so the client can hide unavailable AI features. */
export type SuggestionModel = "opus" | "terra";
export type SuggestionStrategy =
  | "answer"
  | "clarify"
  | "advance"
  | "defer"
  | "decline"
  | "close"
  | "react";
export type SuggestionVibe = "curious" | "affirmative" | "cautious" | "boundary" | "playful";
export type TapbackType = "love" | "like" | "dislike" | "laugh" | "emphasize" | "question";

export interface AiStatus {
  /** Direct suggestion lane reachable — gateway key present. */
  suggestions: boolean;
  /** Whether this BlueBubbles server supports outbound tapbacks. */
  reactionSuggestions: boolean;
  /** When the Mini's agent runner last beat, by its clock; null if it never has. */
  agentHeartbeatAt: number | null;
}

export interface ReplySuggestion {
  id: string;
  kind: "text" | "reaction";
  strategy: SuggestionStrategy;
  vibe: SuggestionVibe;
  text: string;
  /** A reaction key from the route's platform profile. */
  reaction: string | null;
  targetMessageGuid: string | null;
  targetMessagePreview: string | null;
  targetPartIndex: number | null;
}

/**
 * A concrete scheduling agreement detected in the thread — "Sunday 6pm works",
 * not a vague "let's hang soon". Rendered as an add-to-calendar affordance;
 * creating the event stays a user tap in Google Calendar's own UI.
 */
export interface EventSuggestion {
  title: string;
  /** Local wall-clock start, "YYYY-MM-DDTHH:mm" — no timezone. */
  start: string;
  durationMinutes: number;
  location: string | null;
  /** Contact emails of the other side(s), prefilled as guests. */
  inviteEmails: string[];
}

export interface ReplySuggestions {
  suggestions: ReplySuggestion[];
  event: EventSuggestion | null;
  recipeVersion: number;
  selectedModel: SuggestionModel;
  servedModel: SuggestionModel;
  fallback: boolean;
  noReply: boolean;
  /** Guid of the last message when these were generated. */
  basedOnMessageGuid: string | null;
  /** True when newer messages have arrived since generation. */
  stale: boolean;
  generatedAt: number;
}

export interface SuggestionFeedbackRequest {
  suggestion: ReplySuggestion;
  selectedModel: SuggestionModel;
  servedModel: SuggestionModel;
  recipeVersion: number;
  selectedAt: number;
  finalText: string;
}

export interface ContactSuggestion {
  name: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}
