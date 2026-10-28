import { WANTS_YOU } from "./agent-attention";
import type { ChatFlags, ChatSummary, Message, StateCounts, StateFilter, TypeFilter } from "./types";

/**
 * Chat State — the pure rules for a chat's flags: how Unresponded / Waiting /
 * Unread derive from the Overlay + last message, how a new message flips them
 * (the SSE fast path), and which lens a chat matches. The single implementation
 * shared by the server and the client.
 */

/** Per-chat Overlay row: app-local state BlueBubbles knows nothing about. */
export interface ChatState {
  chatGuid: string;
  /** Last-message GUID at the moment "unresponded" was dismissed. */
  dismissedUnrespondedGuid: string | null;
  /** Last-message GUID at the moment "waiting on them" was dismissed. */
  dismissedWaitingGuid: string | null;
  /** Chat never appears in the unresponded filter (group mute). */
  mutedUnresponded: number;
  pinned: number;
  /** Epoch ms of our last mark-read — survives restarts. Apple never
   * back-fills dateRead on old group messages, so the raw scan alone would
   * resurrect them as unread forever. */
  readAt?: number;
  /** Manually marked unread; cleared on next mark-read. */
  markedUnread: number;
}

interface LastMessageLike {
  guid: string;
  dateCreated: number;
  isFromMe: boolean;
}

export function computeFlags(
  state: ChatState | undefined,
  last: LastMessageLike | null,
  unreadCount: number,
): ChatFlags {
  const unresponded =
    last !== null && !last.isFromMe && state?.dismissedUnrespondedGuid !== last.guid;
  const waiting = last !== null && last.isFromMe && state?.dismissedWaitingGuid !== last.guid;
  return {
    unresponded,
    waiting,
    unread: unreadCount > 0 || state?.markedUnread === 1,
    mutedUnresponded: false,
    pinned: state?.pinned === 1,
  };
}

/** A conversation is known when any participant matched a contact. Convex computes `known` with this too. */
export const knownParticipants = (participants: readonly { name: string | null }[]): boolean =>
  participants.some((p) => p.name !== null);

/**
 * A screened conversation is junk, or from someone no contact matches.
 * Contact failures fail open instead of making the whole inbox disappear.
 */
function isScreened(chat: ChatSummary): boolean {
  return chat.isSpam || (chat.contactsAvailable !== false && !chat.known);
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
    case "unresponded":
    case "waiting":
    case "agents":
      return action === "settle";
    case "settled":
      return action === "unsettle";
  }
}

const STATES: StateFilter[] = ["all", "unread", "unresponded", "waiting", "drafts", "agents", "settled"];

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

/**
 * The SSE fast path: applies a message we already know about directly to a
 * summary list, ahead of a full rebuild — new last message, flag flips
 * (inbound starts Unresponded; outbound starts Waiting), chat moved to the top.
 *
 * Returns the input array unchanged when the message is stale (older than the
 * chat's last message), or null when the chat isn't in the list — the caller
 * decides whether that means "ignore" or "rebuild".
 */
export function applyMessage(
  chats: ChatSummary[],
  chatGuid: string,
  message: Message,
): ChatSummary[] | null {
  const index = chats.findIndex((c) => c.guid === chatGuid);
  const chat = index >= 0 ? chats[index] : undefined;
  if (!chat) return null;
  if ((chat.lastMessage?.dateCreated ?? 0) > message.dateCreated) return chats;
  // Replying reads the conversation, so an outbound message clears the count.
  // A manual mark-unread (flag set with no count) survives it.
  const qualifiesForUnreadAge =
    !message.isFromMe &&
    message.dateRead === null &&
    !message.retracted &&
    !message.isGroupEvent &&
    message.isAssociatedMessage !== true;
  const firstUnreadAt = message.isFromMe
    ? null
    : qualifiesForUnreadAge
      ? Math.min(chat.firstUnreadAt ?? message.dateCreated, message.dateCreated)
      : chat.firstUnreadAt;
  const updated: ChatSummary = {
    ...chat,
    isSpam: message.isSpam === true,
    firstUnreadAt,
    unreadCount: message.isFromMe ? 0 : qualifiesForUnreadAge ? chat.unreadCount + 1 : chat.unreadCount,
    lastMessage: {
      guid: message.guid,
      text: message.text || (message.attachments.length > 0 ? "Attachment" : ""),
      dateCreated: message.dateCreated,
      isFromMe: message.isFromMe,
      senderName: message.sender?.name ?? message.sender?.address ?? null,
      hasAttachments: message.attachments.length > 0,
    },
    flags: {
      ...chat.flags,
      unresponded: !message.isFromMe,
      waiting: message.isFromMe,
      unread: message.isFromMe ? chat.flags.unread && chat.unreadCount === 0 : true,
    },
  };
  const next = [...chats];
  next.splice(index, 1);
  next.unshift(updated);
  return next;
}
