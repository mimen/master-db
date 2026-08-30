import type { ChatFlags, ChatSummary, Message, StateCounts, StateFilter, TypeFilter } from "./types";

/**
 * Chat State — the pure rules for a chat's flags: how Unresponded / Waiting /
 * Unread / Archived derive from the Overlay + last message, how a new message
 * flips them (the SSE fast path), and which lens a chat matches. The single
 * implementation shared by the server and the client.
 */

/** Per-chat Overlay row: app-local state BlueBubbles knows nothing about. */
export interface ChatState {
  chatGuid: string;
  /** Epoch ms when the chat was archived; null = not archived. */
  archivedAt: number | null;
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
  /** Active Later deadline and the last-message GUID it was anchored to. */
  laterUntil?: number | null;
  laterAnchorGuid?: string | null;
}

interface LastMessageLike {
  guid: string;
  dateCreated: number;
  isFromMe: boolean;
}

/**
 * Archive is lazily self-clearing: a chat counts as archived only while no
 * inbound message is newer than the archive timestamp (auto-unarchive).
 */
export function isArchived(state: ChatState | undefined, last: LastMessageLike | null): boolean {
  if (!state?.archivedAt) return false;
  if (last && !last.isFromMe && last.dateCreated > state.archivedAt) return false;
  return true;
}

export function isLaterActive(
  state: ChatState | undefined,
  last: LastMessageLike | null,
  now: number = Date.now(),
): boolean {
  if (!state?.laterUntil || state.laterUntil <= now) return false;
  return last !== null && last.guid === state.laterAnchorGuid;
}

export function computeFlags(
  state: ChatState | undefined,
  last: LastMessageLike | null,
  unreadCount: number,
  now: number = Date.now(),
): ChatFlags {
  const archived = isArchived(state, last);
  const laterActive = isLaterActive(state, last, now);
  const unresponded =
    last !== null &&
    !last.isFromMe &&
    state?.dismissedUnrespondedGuid !== last.guid &&
    !laterActive;
  const waiting =
    last !== null && last.isFromMe && state?.dismissedWaitingGuid !== last.guid && !laterActive;
  return {
    archived,
    unresponded,
    waiting,
    unread: unreadCount > 0 || state?.markedUnread === 1,
    mutedUnresponded: false,
    pinned: state?.pinned === 1,
  };
}

export function matchesFilters(chat: ChatSummary, state: StateFilter, type: TypeFilter): boolean {
  const unknown = chat.contactsAvailable !== false && !chat.known;
  const screened = chat.isSpam || unknown;
  // Unknown is the explicit reveal surface for screened conversations. Every
  // other type lens keeps them out of the inbox, counts, inbox search, and shelf.
  // Contact failures fail open instead of making the whole inbox disappear.
  if (type === "unknown") {
    if (!screened) return false;
  } else {
    if (screened) return false;
    if (type === "dm" && chat.isGroup) return false;
    if (type === "group" && !chat.isGroup) return false;
  }
  switch (state) {
    case "all":
      return !chat.flags.archived;
    case "unread":
      return chat.flags.unread && !chat.flags.archived;
    case "unresponded":
      return chat.flags.unresponded && !chat.flags.archived;
    case "waiting":
      return chat.flags.waiting && !chat.flags.archived;
    case "archived":
      return chat.flags.archived;
  }
}

const STATES: StateFilter[] = ["all", "unread", "unresponded", "waiting", "archived"];

export function computeCounts(chats: ChatSummary[], type: TypeFilter): StateCounts {
  return Object.fromEntries(
    STATES.map((state) => [state, chats.filter((c) => matchesFilters(c, state, type)).length]),
  ) as StateCounts;
}

export interface PriorityShelfPartition {
  priority: ChatSummary[];
  recent: ChatSummary[];
}

/**
 * Selects the shelf's (up to 10) conversations, CRM priority first:
 *
 *   1. Chats with CRM priority P1–P2, best priority first (P1 before P2);
 *      ties within a priority level break on the same oldest-unread
 *      ordering as the fallback tier, then original index (so a
 *      no-unread P1 still sorts deterministically against another
 *      no-unread P1).
 *   2. Remaining slots fill with today's oldest-unread chats (unchanged
 *      rule), skipping anything already placed by (1).
 *
 * A chat with no unread AND no P1/P2 priority never appears here — the
 * shelf must not become a permanent pin list. When nothing in the input has
 * CRM priority, this is exactly the old "10 oldest unread" behavior.
 */
export function partitionPriorityShelf(chats: ChatSummary[]): PriorityShelfPartition {
  const indexed = chats.map((chat, index) => ({ chat, index }));

  const highPriority = ({ chat }: { chat: ChatSummary }): boolean =>
    chat.crm?.priority === 1 || chat.crm?.priority === 2;

  // Oldest-unread-first, with no-unread entries sorted after any unread
  // entry (by original index among themselves) — the same tie-break the
  // old unread-only selection used, extended to rank a no-unread priority
  // chat below any unread chat within its own priority tier.
  const byOldestUnread = (
    a: { chat: ChatSummary; index: number },
    b: { chat: ChatSummary; index: number },
  ): number => {
    const aAt = a.chat.firstUnreadAt;
    const bAt = b.chat.firstUnreadAt;
    if (typeof aAt === "number" && typeof bAt === "number") return aAt - bAt || a.index - b.index;
    if (typeof aAt === "number") return -1;
    if (typeof bAt === "number") return 1;
    return a.index - b.index;
  };

  const priorityTier = indexed
    .filter(highPriority)
    .sort((a, b) => a.chat.crm!.priority! - b.chat.crm!.priority! || byOldestUnread(a, b));
  const priorityTierChats = new Set(priorityTier.map(({ chat }) => chat));

  const unreadTier = indexed
    .filter(({ chat }) => !priorityTierChats.has(chat) && typeof chat.firstUnreadAt === "number")
    .sort(byOldestUnread);

  const priority = [...priorityTier, ...unreadTier].slice(0, 10).map(({ chat }) => chat);
  const priorityChats = new Set(priority);
  return {
    priority,
    recent: chats.filter((chat) => !priorityChats.has(chat)),
  };
}

/**
 * The SSE fast path: applies a message we already know about directly to a
 * summary list, ahead of a full rebuild — new last message, flag flips
 * (inbound clears Archived and starts Unresponded; outbound starts Waiting),
 * chat moved to the top.
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
  const qualifiesForUnreadAge =
    !message.isFromMe &&
    message.dateRead === null &&
    !message.retracted &&
    !message.isGroupEvent &&
    message.isAssociatedMessage !== true;
  const firstUnreadAt = qualifiesForUnreadAge
    ? Math.min(chat.firstUnreadAt ?? message.dateCreated, message.dateCreated)
    : chat.firstUnreadAt;
  const updated: ChatSummary = {
    ...chat,
    isSpam: message.isSpam === true,
    firstUnreadAt,
    unreadCount: qualifiesForUnreadAge ? chat.unreadCount + 1 : chat.unreadCount,
    lastMessage: {
      guid: message.guid,
      text: message.text || (message.attachments.length > 0 ? "Attachment" : ""),
      dateCreated: message.dateCreated,
      isFromMe: message.isFromMe,
      senderName: message.sender?.name ?? message.sender?.address ?? null,
      hasAttachments: message.attachments.length > 0,
    },
    laterUntil: message.isFromMe ? chat.laterUntil : null,
    flags: {
      ...chat.flags,
      unresponded: !message.isFromMe,
      waiting: message.isFromMe,
      unread: message.isFromMe ? chat.flags.unread : true,
      archived: message.isFromMe ? chat.flags.archived : false,
    },
  };
  const next = [...chats];
  next.splice(index, 1);
  next.unshift(updated);
  return next;
}
