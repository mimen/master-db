import { WANTS_YOU } from "./agent-attention";
import { attentionOf, screeningOf } from "./platform-profile";
import type { ChatFlags, ChatSummary, ConversationKind, Platform, StateCounts, StateFilter, TypeFilter } from "./types";

/**
 * Chat State — the pure rules for a chat's flags: how Unresponded / Waiting /
 * Unread derive from Comma's triage state + last message, and which lens a chat
 * matches. Convex computes the flags with these, and the client filters with them.
 */

/** A conversation's triage state, as Convex keeps it: app-local state BlueBubbles knows nothing about. */
export interface ChatState {
  /** Last-message GUID at the moment "unresponded" was dismissed. */
  dismissedUnrespondedGuid?: string;
  /** Last-message GUID at the moment "waiting on them" was dismissed. */
  dismissedWaitingGuid?: string;
  /** Recorded, but Needs you no longer honors it. */
  mutedUnresponded: boolean;
  pinned: boolean;
  /** Epoch ms of the last read in Comma. Apple never back-fills dateRead on
   * old group messages, so chat.db's count alone would resurrect them as
   * unread forever. */
  readAt: number;
  /** Manually marked unread; cleared on next mark-read. */
  markedUnread: boolean;
}

interface LastMessageLike {
  guid: string;
  dateCreated: number;
  isFromMe: boolean;
}

/** What core logic knows of a conversation to ask its platform's rules. */
export interface RuledConversation {
  platform: Platform;
  kind: ConversationKind;
}

/** Unresponded and Waiting are the platform's attention for the last message, until that message is dismissed. */
export function computeFlags(
  conversation: RuledConversation,
  state: ChatState | undefined,
  last: LastMessageLike | null,
  unreadCount: number,
): ChatFlags {
  const attention = attentionOf(conversation, last);
  const unresponded = last !== null && attention === "needsYou" && state?.dismissedUnrespondedGuid !== last.guid;
  const waiting = last !== null && attention === "waiting" && state?.dismissedWaitingGuid !== last.guid;
  return {
    unresponded,
    waiting,
    unread: unreadCount > 0 || state?.markedUnread === true,
    mutedUnresponded: false,
    pinned: state?.pinned === true,
  };
}

/** A conversation's flags and unread count as Convex lists it. A read at or after the last message zeroes the count. */
export function conversationFlags(
  conversation: RuledConversation,
  state: ChatState | undefined,
  last: LastMessageLike | null,
  lastMessageAt: number,
  unread: number,
): { flags: ChatFlags; unreadCount: number } {
  const unreadCount = (state?.readAt ?? 0) >= lastMessageAt ? 0 : unread;
  return { flags: computeFlags(conversation, state, last, unreadCount), unreadCount };
}

/**
 * A screened conversation is junk, or from a stranger. Contact failures fail open for strangers instead of making
 * the whole inbox disappear.
 */
function isScreened(chat: ChatSummary): boolean {
  const screening = screeningOf({ platform: chat.route.platform, isSpam: chat.isSpam, known: chat.known });
  return screening === "spam" || (screening === "stranger" && chat.contactsAvailable !== false);
}

/**
 * The type lens is ONE axis over the screening boundary, not two crossed ones:
 *
 *   Everyone  every conversation, screened included
 *   Known     the default inbox, everything except screened
 *   DMs       known one-on-one conversations
 *   Groups    known group conversations
 *   Unknown   screened conversations, and only those
 *
 * DMs and Groups stay deliberately known-only. A stranger's one-on-one lives
 * under Unknown, not under DMs. That conflation is chosen, not incidental.
 *
 * No default arm, so a new lens has to answer the screening question before
 * it compiles.
 */
function matchesTypeLens(chat: ChatSummary, type: TypeFilter): boolean {
  switch (type) {
    case "all":
      return true;
    case "known":
      return !isScreened(chat);
    case "dm":
      return !isScreened(chat) && !chat.isGroup;
    case "group":
      return !isScreened(chat) && chat.isGroup;
    case "unknown":
      return isScreened(chat);
  }
}

export function matchesFilters(chat: ChatSummary, state: StateFilter, type: TypeFilter): boolean {
  if (!matchesTypeLens(chat, type)) return false;
  switch (state) {
    case "today":
      // Today is a plan over the whole directory (client/src/lib/today.ts), not a per-chat predicate.
      return false;
    case "all":
      return true;
    case "unread":
      return chat.flags.unread;
    case "unresponded":
      // An open agent chat is a reply the user owes too, whatever the last message was.
      return chat.flags.unresponded || chat.agent !== undefined;
    case "waiting":
      return chat.flags.waiting;
    case "drafts":
      return chat.draft !== undefined;
    case "agents":
      return chat.agent !== undefined;
    case "settled":
      return isSettled(chat);
  }
}

/**
 * Settled: a conversation with a last message, neither triage flag, and no
 * unsettled agent chat.
 *
 * The client never sees a dismissal GUID, so settled is read off the derived
 * flags instead. Equivalent by construction: for a chat with a last message,
 * unresponded is false only when that message is outbound or its anchor was
 * dismissed, and waiting is false only when it is inbound or its anchor was
 * dismissed.
 */
export function isSettled(chat: ChatSummary): boolean {
  return chat.lastMessage !== null && !chat.flags.unresponded && !chat.flags.waiting && chat.agent === undefined;
}

/** What the one triage gesture does to a conversation in its current state. */
export type SettleAction = "settle" | "unsettle" | "none";

/**
 * Settle is one toggle keyed to conversation state, never to the lens: a
 * conversation carrying either triage flag or an unsettled agent chat
 * settles, a settled one un-settles. "none" is only ever a conversation with
 * no messages, where there is no triage state to move in either direction.
 */
export function settleActionFor(chat: ChatSummary): SettleAction {
  if (chat.flags.unresponded || chat.flags.waiting || chat.agent !== undefined) return "settle";
  return isSettled(chat) ? "unsettle" : "none";
}

/**
 * Does the gesture drop the row out of the lens the user is looking at? Only
 * then should the keyboard cursor glide onto a neighbor — settling from All
 * or Unread leaves the row exactly where it was. No default arm, so a new
 * lens has to answer this question before it compiles.
 */
export function settleLeavesLens(action: SettleAction, state: StateFilter): boolean {
  switch (state) {
    case "all":
    case "unread":
    case "drafts":
      return false;
    case "today":
    case "unresponded":
    case "waiting":
    case "agents":
      return action === "settle";
    case "settled":
      return action === "unsettle";
  }
}

const STATES: StateFilter[] = ["today", "all", "unread", "unresponded", "waiting", "drafts", "agents", "settled"];

/** The Agents count is only the chats that want the user; a working or open one shows in the lens without counting. */
function counts(chat: ChatSummary, state: StateFilter, type: TypeFilter): boolean {
  if (!matchesFilters(chat, state, type)) return false;
  return state !== "agents" || (chat.agent !== undefined && WANTS_YOU.has(chat.agent.attention));
}

export function computeCounts(chats: ChatSummary[], type: TypeFilter): StateCounts {
  return Object.fromEntries(
    STATES.map((state) => [state, chats.filter((c) => counts(c, state, type)).length]),
  ) as StateCounts;
}
