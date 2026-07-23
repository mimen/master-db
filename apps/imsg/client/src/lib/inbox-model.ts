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

/** Where a navigable conversation is rendered: the horizontal priority shelf
 * or the vertical list. Keyboard code dispatches reveal-behavior on this. */
export type InboxNavigationLocation =
  | { kind: "priority"; index: number }
  | { kind: "list"; index: number };

export interface InboxNavigationEntry {
  chat: ChatSummary;
  location: InboxNavigationLocation;
}

/** Derived presentation data for the conversation list and priority shelf. */
export interface InboxModel {
  /** Whether the priority shelf is meaningful for this unfiltered inbox view. */
  showPriorityShelf: boolean;
  /** Oldest unread conversations, sorted by their first unread timestamp. */
  priority: ChatSummary[];
  /** The main list, with pinned recent chats placed before unpinned recent chats. */
  listChats: ChatSummary[];
  /** Every navigable conversation in RENDERED order (shelf first, then list),
   * with its rendered location — the single source of keyboard order. */
  navigationEntries: InboxNavigationEntry[];
  /** Contextual heading above the main list. */
  sectionLabel: string;
  /** The count rendered beside the heading. */
  sectionCount: number;
}

/** The entry `delta` steps from the selected chat, clamped to the ends.
 * Unknown/absent selection resolves to the first entry. */
export function nextNavigationTarget(
  entries: readonly InboxNavigationEntry[],
  selectedGuid: string | undefined,
  delta: -1 | 1,
): InboxNavigationEntry | null {
  if (entries.length === 0) return null;
  const idx = entries.findIndex((e) => e.chat.guid === selectedGuid);
  if (idx === -1) return entries[0] ?? null;
  return entries[Math.max(0, Math.min(entries.length - 1, idx + delta))] ?? null;
}

/** After `guid` leaves the view (archive), the neighbor to glide onto:
 * the next entry, else the previous, else nothing. */
export function neighborAfterRemoval(
  entries: readonly InboxNavigationEntry[],
  guid: string,
): InboxNavigationEntry | null {
  const idx = entries.findIndex((e) => e.chat.guid === guid);
  if (idx === -1) return null;
  return entries[idx + 1] ?? entries[idx - 1] ?? null;
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
  deepMatchGuids?: ReadonlySet<string>,
  /** Frozen browse membership (useChats' triage freeze). When provided, blank-
   * query browsing selects EXACTLY these guids from the universe — reapplying
   * live filters here would evict rows mid-triage, defeating the freeze. */
  browseGuids?: Set<string>,
): InboxModel {
  const needle = searchQuery.trim().toLowerCase();
  const needleDigits = needle.replace(/\D/g, "");
  const matchesNeedle = (chat: ChatSummary): boolean =>
    chat.displayName.toLowerCase().includes(needle) ||
    (chat.lastMessage?.text ?? "").toLowerCase().includes(needle) ||
    // Participants carry FULL names (group display names are first-names-only,
    // so last names would otherwise never match a group) plus raw addresses.
    chat.participants.some(
      (p) =>
        (p.name ?? "").toLowerCase().includes(needle) ||
        p.address.toLowerCase().includes(needle) ||
        (needleDigits.length >= 3 && p.address.replace(/\D/g, "").includes(needleDigits)),
    ) ||
    Boolean(deepMatchGuids?.has(chat.guid));
  // Search is a MODE that supersedes the badge lenses entirely — a query
  // matches across every state and type (archived included).
  const searchedChats = chats.filter((chat) =>
    needle.length === 0
      ? browseGuids
        ? browseGuids.has(chat.guid)
        : matchesFilters(chat, filters.state, filters.type)
      : matchesNeedle(chat),
  );
  const showPriorityShelf = filters.state === "all" && filters.type === "all" && needle.length === 0;
  const { priority, recent } = partitionPriorityShelf(searchedChats);
  const shelf = showPriorityShelf ? priority : [];
  const listSource = showPriorityShelf ? recent : searchedChats;
  const listChats = [
    ...listSource.filter((chat) => chat.flags.pinned),
    ...listSource.filter((chat) => !chat.flags.pinned),
  ];
  const navigationEntries: InboxNavigationEntry[] = [
    ...shelf.map((chat, index) => ({ chat, location: { kind: "priority", index } as const })),
    ...listChats.map((chat, index) => ({ chat, location: { kind: "list", index } as const })),
  ];
  return {
    showPriorityShelf,
    priority: shelf,
    listChats,
    navigationEntries,
    sectionLabel: sectionLabel(filters, needle.length > 0),
    sectionCount: listChats.length,
  };
}
