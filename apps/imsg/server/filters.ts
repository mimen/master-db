import type { ChatFlags, ChatSummary, StateFilter, TypeFilter } from "../shared/types";
import type { ChatState } from "./db";

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

export function computeFlags(
  state: ChatState | undefined,
  last: LastMessageLike | null,
  unreadCount: number,
): ChatFlags {
  const archived = isArchived(state, last);
  const unresponded =
    last !== null &&
    !last.isFromMe &&
    state?.dismissedUnrespondedGuid !== last.guid &&
    state?.mutedUnresponded !== 1;
  const waiting = last !== null && last.isFromMe && state?.dismissedWaitingGuid !== last.guid;
  return {
    archived,
    unresponded,
    waiting,
    unread: unreadCount > 0,
    mutedUnresponded: state?.mutedUnresponded === 1,
  };
}

export function matchesFilters(chat: ChatSummary, state: StateFilter, type: TypeFilter): boolean {
  if (type === "dm" && chat.isGroup) return false;
  if (type === "group" && !chat.isGroup) return false;
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
