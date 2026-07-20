import { matchesFilters, partitionPriorityShelf } from "@shared/chat-state";
import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";

/** The two independent lenses that define the visible conversation list. */
export interface InboxFilters {
  state: StateFilter;
  type: TypeFilter;
}

export type InboxFilterSelection =
  | { kind: "state"; value: StateFilter }
  | { kind: "type"; value: TypeFilter };

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  state: "all",
  type: "all",
};

/**
 * Applies one lens selection without resetting the other lens. State and type
 * are intentionally independent, so every state/type pair remains reachable.
 */
export function selectInboxFilter(
  filters: InboxFilters,
  selection: InboxFilterSelection,
): InboxFilters {
  if (selection.kind === "state") {
    return { ...filters, state: selection.value };
  }
  return { ...filters, type: selection.value };
}

export function resetInboxFilters(): InboxFilters {
  return { ...DEFAULT_INBOX_FILTERS };
}

export function activeInboxFilterCount(filters: InboxFilters): number {
  return Number(filters.state !== "all") + Number(filters.type !== "all");
}

const STATE_LABELS: Record<StateFilter, string> = {
  all: "All",
  unread: "Unread",
  unresponded: "Unresponded",
  waiting: "Waiting",
  archived: "Archived",
};

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: "Everyone",
  dm: "DMs",
  group: "Groups",
  unknown: "Unknown",
};

function sectionLabel(filters: InboxFilters, hasSearch: boolean): string {
  if (hasSearch) return "Search Results";
  if (filters.state === "all" && filters.type === "all") return "Recent";
  if (filters.state === "all") return TYPE_LABELS[filters.type];
  if (filters.type === "all") return STATE_LABELS[filters.state];
  return `${STATE_LABELS[filters.state]} · ${TYPE_LABELS[filters.type]}`;
}

/** Derived presentation data for the conversation list and priority shelf. */
export interface InboxModel {
  /** Chats matching both active lenses and the normalized search query. */
  searchedChats: ChatSummary[];
  /** Whether the priority shelf is meaningful for this unfiltered inbox view. */
  showPriorityShelf: boolean;
  /** Oldest unread conversations, sorted by their first unread timestamp. */
  priority: ChatSummary[];
  /** Remaining chats in their incoming order after priority chats are removed. */
  recent: ChatSummary[];
  /** The main list, with pinned recent chats placed before unpinned recent chats. */
  listChats: ChatSummary[];
  /** Contextual heading above the main list. */
  sectionLabel: string;
  /** The count rendered beside the heading. */
  sectionCount: number;
}

/**
 * Produces the complete presentation model from the chat directory. This keeps
 * lens filtering, text search, priority eligibility, and pinned ordering in
 * one pure function so every state/type pair follows the same rules.
 */
export function deriveInboxModel(
  chats: ChatSummary[],
  filters: InboxFilters,
  searchQuery: string,
  /** Chat GUIDs whose deeper message history matched the query (server search). */
  deepMatchGuids?: Set<string>,
): InboxModel {
  const needle = searchQuery.trim().toLowerCase();
  const searchedChats = chats.filter((chat) => {
    if (!matchesFilters(chat, filters.state, filters.type)) return false;
    if (needle.length === 0) return true;
    return (
      chat.displayName.toLowerCase().includes(needle) ||
      (chat.lastMessage?.text ?? "").toLowerCase().includes(needle) ||
      Boolean(deepMatchGuids?.has(chat.guid))
    );
  });
  const showPriorityShelf = filters.state === "all" && filters.type === "all" && needle.length === 0;
  const { priority, recent } = partitionPriorityShelf(searchedChats);
  const listSource = showPriorityShelf ? recent : searchedChats;
  const listChats = [
    ...listSource.filter((chat) => chat.flags.pinned),
    ...listSource.filter((chat) => !chat.flags.pinned),
  ];
  return {
    searchedChats,
    showPriorityShelf,
    priority,
    recent,
    listChats,
    sectionLabel: sectionLabel(filters, needle.length > 0),
    sectionCount: listChats.length,
  };
}
