import { isSettled, matchesFilters } from "@shared/chat-state";
import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";

/** The two lenses the workspace owns: which queue, and whose conversations. */
export interface InboxFilters {
  state: StateFilter;
  type: TypeFilter;
}

/**
 * The unfiltered view. "Known" is the default rather than "Everyone" because
 * Everyone now genuinely means everyone, screened conversations included.
 */
export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  state: "all",
  type: "known",
};

export function isDefaultStateLens(state: StateFilter): boolean {
  return state === DEFAULT_INBOX_FILTERS.state;
}

export function isDefaultTypeLens(type: TypeFilter): boolean {
  return type === DEFAULT_INBOX_FILTERS.type;
}

export function resetInboxFilters(): InboxFilters {
  return { ...DEFAULT_INBOX_FILTERS };
}

/** The tab row. Settled is reached through "Also include", not a tab. */
export type Lens = "unresponded" | "unread" | "waiting" | "all";

export const LENSES: readonly { value: Lens; label: string; count: "turn" | "plain" | null }[] = [
  { value: "unresponded", label: "Needs reply", count: "turn" },
  { value: "unread", label: "Unread", count: "plain" },
  { value: "waiting", label: "Waiting", count: null },
  { value: "all", label: "All", count: null },
];

export function lensOf(state: StateFilter): Lens | null {
  return state === "settled" ? null : state;
}

export type Service = "any" | "iMessage" | "SMS";
export type TimeRange = "any" | "today" | "week" | "month";
export type PriorityLevel = "any" | "high" | "medium" | "low";
export type OnlyKey = "attachments" | "links" | "pinned" | "favorites";
export type IncludeKey = "settled" | "scheduled";

/** Everything the filter popover narrows or widens, per lens. People rides InboxFilters.type. */
export interface Refinements {
  service: Service;
  time: TimeRange;
  priority: PriorityLevel;
  tags: readonly string[];
  only: readonly OnlyKey[];
  include: readonly IncludeKey[];
}

export const DEFAULT_REFINEMENTS: Refinements = {
  service: "any",
  time: "any",
  priority: "any",
  tags: [],
  only: [],
  include: [],
};

export const PEOPLE_LABELS: Record<TypeFilter, string> = {
  all: "Anyone",
  known: "Known contacts",
  unknown: "Unknown numbers",
  group: "Groups",
  dm: "One-to-one",
};
const LENS_TITLES: Record<StateFilter, string> = {
  all: "All messages",
  unread: "Unread",
  unresponded: "Needs reply",
  waiting: "Waiting",
  settled: "Settled",
};

/** The lens as a heading. It names People whenever it is off its default, so "All messages" never hides a filter. */
export function desktopInboxTitle(filters: InboxFilters): string {
  const state = LENS_TITLES[filters.state];
  return isDefaultTypeLens(filters.type) ? state : `${state} · ${PEOPLE_LABELS[filters.type]}`;
}

export const PEOPLE_ORDER: readonly TypeFilter[] = ["all", "known", "unknown", "group", "dm"];

export const SERVICE_LABELS: Record<Service, string> = { any: "Any service", iMessage: "iMessage", SMS: "SMS" };
export const TIME_LABELS: Record<TimeRange, string> = {
  any: "Any time",
  today: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
};
export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  any: "Any priority",
  high: "High",
  medium: "Medium",
  low: "Low",
};
export const ONLY_LABELS: Record<OnlyKey, string> = {
  attachments: "Has attachments",
  links: "Has links",
  pinned: "Pinned",
  favorites: "Favorites",
};
export const INCLUDE_LABELS: Record<IncludeKey, string> = {
  settled: "Settled",
  scheduled: "Has a scheduled message",
};

const DAY = 86_400_000;
const LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;

/** Service of the conversation's primary chat. RCS renders green, so it reads as SMS. */
export function chatService(chat: Pick<ChatSummary, "guid">): Exclude<Service, "any"> | null {
  const prefix = chat.guid.split(";")[0];
  if (prefix === "iMessage") return "iMessage";
  if (prefix === "SMS" || prefix === "RCS") return "SMS";
  return null;
}

/** CRM priority is P1-P5 with one highest: P1-P2 high, P3 medium, P4-P5 low. */
export function priorityLevel(priority: number | undefined): Exclude<PriorityLevel, "any"> | null {
  if (priority === undefined) return null;
  return priority <= 2 ? "high" : priority === 3 ? "medium" : "low";
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function inTime(at: number, range: TimeRange, now: number): boolean {
  switch (range) {
    case "any":
      return true;
    case "today":
      return at >= startOfDay(now);
    case "week":
      return now - at <= 7 * DAY;
    case "month":
      return now - at <= 30 * DAY;
  }
}

// ponytail: attachments and links read the last message only; a per-conversation
// flag in the Convex view would cover the whole history.
const ONLY: Record<OnlyKey, (chat: ChatSummary) => boolean> = {
  attachments: (chat) => chat.lastMessage?.hasAttachments === true,
  links: (chat) => LINK.test(chat.lastMessage?.text ?? ""),
  pinned: (chat) => chat.flags.pinned,
  favorites: (chat) => chat.crm?.is_favorite === true,
};

export interface RefineContext {
  refinements: Refinements;
  /** Conversation ids and chat guids with a pending scheduled message. */
  scheduled: ReadonlySet<string>;
  now: number;
}

function hasScheduled(chat: ChatSummary, scheduled: ReadonlySet<string>): boolean {
  return scheduled.has(chat.guid) || (chat.conversationId !== undefined && scheduled.has(chat.conversationId));
}

/** The narrowing half: every control except Also include. */
function narrows(chat: ChatSummary, r: Refinements, now: number): boolean {
  if (r.service !== "any" && chatService(chat) !== r.service) return false;
  if (r.time !== "any" && !inTime(chat.lastMessage?.dateCreated ?? 0, r.time, now)) return false;
  if (r.priority !== "any" && priorityLevel(chat.crm?.priority) !== r.priority) return false;
  if (r.tags.length > 0 && !r.tags.some((tag) => chat.crm?.tags?.includes(tag))) return false;
  return r.only.every((key) => ONLY[key](chat));
}

/** Also include widens the lens with conversations it normally hides, within the People lens. */
function included(chat: ChatSummary, type: TypeFilter, ctx: RefineContext): boolean {
  if (!matchesFilters(chat, "all", type)) return false;
  return ctx.refinements.include.some((key) =>
    key === "settled" ? isSettled(chat) : hasScheduled(chat, ctx.scheduled),
  );
}

export interface FilterChip {
  key: string;
  /** A multi-value control's key, set before the value ("Tag Showcase"). */
  prefix?: string;
  label: string;
  remove: (filters: InboxFilters, r: Refinements) => { filters: InboxFilters; refinements: Refinements };
}

/** One chip per active control value, in popover order. The filter icon's badge is its length. */
export function activeChips(filters: InboxFilters, r: Refinements): FilterChip[] {
  const chips: FilterChip[] = [];
  const keep = (next: Partial<Refinements>) => (f: InboxFilters, cur: Refinements) => ({ filters: f, refinements: { ...cur, ...next } });
  if (!isDefaultTypeLens(filters.type)) {
    chips.push({ key: "people", label: PEOPLE_LABELS[filters.type], remove: (f, cur) => ({ filters: { ...f, type: DEFAULT_INBOX_FILTERS.type }, refinements: cur }) });
  }
  if (r.service !== "any") chips.push({ key: "service", label: SERVICE_LABELS[r.service], remove: keep({ service: "any" }) });
  if (r.time !== "any") chips.push({ key: "time", label: TIME_LABELS[r.time], remove: keep({ time: "any" }) });
  if (r.priority !== "any") chips.push({ key: "priority", prefix: "Priority", label: PRIORITY_LABELS[r.priority], remove: keep({ priority: "any" }) });
  for (const tag of r.tags) {
    chips.push({ key: `tag-${tag}`, prefix: "Tag", label: tag, remove: (f, cur) => ({ filters: f, refinements: { ...cur, tags: cur.tags.filter((t) => t !== tag) } }) });
  }
  for (const key of r.only) {
    chips.push({ key: `only-${key}`, label: ONLY_LABELS[key], remove: (f, cur) => ({ filters: f, refinements: { ...cur, only: cur.only.filter((k) => k !== key) } }) });
  }
  for (const key of r.include) {
    chips.push({ key: `include-${key}`, label: INCLUDE_LABELS[key], remove: (f, cur) => ({ filters: f, refinements: { ...cur, include: cur.include.filter((k) => k !== key) } }) });
  }
  return chips;
}

/** A saved view's default name: its chips, in order. */
export function viewName(filters: InboxFilters, r: Refinements): string {
  return activeChips(filters, r).map((chip) => (chip.prefix ? `${chip.prefix} ${chip.label}` : chip.label)).join(", ") || "All filters off";
}

export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Every CRM tag in use across the conversations, sorted, for the Tags dropdown. */
export function tagsInUse(chats: readonly ChatSummary[]): string[] {
  return [...new Set(chats.flatMap((chat) => chat.crm?.tags ?? []))].sort();
}

export type InboxRow =
  | { kind: "section"; key: string; label: string; count: number }
  | { kind: "chat"; key: string; chat: ChatSummary };

export interface InboxNavigationEntry {
  chat: ChatSummary;
  /** Position in `rows`, the rendered list, so scrollToIndex lands on the chat. */
  index: number;
}

export interface InboxModel {
  /** Conversations in rendered order: age groups, each in queueOrder. */
  listChats: ChatSummary[];
  /** The rendered list: Today / This week / Older section rows around the chats. */
  rows: InboxRow[];
  /** Every navigable conversation in rendered order, the single source of keyboard order. */
  navigationEntries: InboxNavigationEntry[];
}

/** The lens order within one age group: pinned, then CRM priority 1-2, then newest first. */
export function queueOrder(chats: readonly ChatSummary[]): ChatSummary[] {
  const rank = (chat: ChatSummary): number =>
    chat.flags.pinned ? 0 : chat.crm?.priority !== undefined && chat.crm.priority <= 2 ? 1 : 2;
  return [...chats].sort((a, b) =>
    rank(a) - rank(b) || (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
}

const AGE_GROUPS = ["Today", "This week", "Older"] as const;

function ageGroup(at: number, now: number): (typeof AGE_GROUPS)[number] {
  if (at >= startOfDay(now)) return "Today";
  return now - at <= 7 * DAY ? "This week" : "Older";
}

/** Splits recency-ordered chats into age sections with counts; empty sections are omitted. */
export function groupByAge(chats: readonly ChatSummary[], now: number): InboxRow[] {
  const buckets = new Map<string, ChatSummary[]>(AGE_GROUPS.map((g) => [g, []]));
  for (const chat of chats) buckets.get(ageGroup(chat.lastMessage?.dateCreated ?? 0, now))?.push(chat);
  return AGE_GROUPS.flatMap((label): InboxRow[] => {
    const group = buckets.get(label) ?? [];
    if (group.length === 0) return [];
    return [
      { kind: "section", key: `section-${label}`, label, count: group.length },
      ...queueOrder(group).map(
        (chat): InboxRow => ({ kind: "chat", key: chat.conversationId ?? chat.guid, chat }),
      ),
    ];
  });
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

/** After `guid` leaves the view, the neighbor to glide onto:
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
 * The conversations a lens shows under its refinements, before grouping.
 * Search is a MODE that supersedes every lens and refinement.
 */
export function filterInbox(
  chats: readonly ChatSummary[],
  filters: InboxFilters,
  searchQuery: string,
  /** Chat GUIDs whose deeper message history matched the query (server search). */
  deepMatchGuids?: ReadonlySet<string>,
  /** Frozen browse membership (useChats' triage freeze). When provided, blank-
   * query browsing selects EXACTLY these guids as the lens base, so live
   * flag changes cannot evict rows mid-triage. */
  browseGuids?: ReadonlySet<string>,
  refine?: RefineContext,
): ChatSummary[] {
  const needle = searchQuery.trim().toLowerCase();
  if (needle.length > 0) {
    const needleDigits = needle.replace(/\D/g, "");
    return chats.filter((chat) =>
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
      Boolean(deepMatchGuids?.has(chat.guid)));
  }
  return chats.filter((chat) => {
    const base = browseGuids ? browseGuids.has(chat.guid) : matchesFilters(chat, filters.state, filters.type);
    if (!refine) return base;
    if (!base && !included(chat, filters.type, refine)) return false;
    return narrows(chat, refine.refinements, refine.now);
  });
}

/** The complete presentation model: filtering, age grouping, and keyboard order in one pure pass. */
export function deriveInboxModel(
  chats: readonly ChatSummary[],
  filters: InboxFilters,
  searchQuery: string,
  deepMatchGuids?: ReadonlySet<string>,
  browseGuids?: ReadonlySet<string>,
  refine?: RefineContext,
): InboxModel {
  const now = refine?.now ?? Date.now();
  const rows = groupByAge(filterInbox(chats, filters, searchQuery, deepMatchGuids, browseGuids, refine), now);
  const navigationEntries = rows.flatMap((row, index) => (row.kind === "chat" ? [{ chat: row.chat, index }] : []));
  return { listChats: navigationEntries.map((e) => e.chat), rows, navigationEntries };
}

/** How many conversations each Only show / Also include box would leave showing, if it were on. */
export function checkboxCounts(
  chats: readonly ChatSummary[],
  filters: InboxFilters,
  browseGuids: ReadonlySet<string> | undefined,
  ctx: RefineContext,
): Record<OnlyKey | IncludeKey, number> {
  const count = (r: Refinements): number => filterInbox(chats, filters, "", undefined, browseGuids, { ...ctx, refinements: r }).length;
  const r = ctx.refinements;
  const only = (key: OnlyKey) => count({ ...r, only: r.only.includes(key) ? r.only : [...r.only, key] });
  const include = (key: IncludeKey) => count({ ...r, include: r.include.includes(key) ? r.include : [...r.include, key] });
  return {
    attachments: only("attachments"),
    links: only("links"),
    pinned: only("pinned"),
    favorites: only("favorites"),
    settled: include("settled"),
    scheduled: include("scheduled"),
  };
}
