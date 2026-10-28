import type { FunctionReturnType } from "convex/server";
import { matchesFilters } from "@shared/chat-state";
import { TODAY_TIME_ZONE } from "@shared/today";
import type { ChatSummary } from "@shared/types";
import type { todayApi } from "./convex-api";
import { queueOrder } from "./inbox-model";

type TodayRow = NonNullable<FunctionReturnType<typeof todayApi.get>>;
type TodayQueueRow = NonNullable<TodayRow["queue"]>;
export type TodayRun = TodayRow["run"];
export type TodayGroup = TodayQueueRow["groups"][number];
export type TodayItem = TodayQueueRow["items"][number];

/** The day's row parsed once per result into lookups keyed by conversationId. */
export interface TodayView {
  day: string;
  dayStart: number;
  run: TodayRun;
  queue: null | {
    snapshotAt: number;
    model: string;
    brief: string;
    groups: readonly TodayGroup[];
    readCount: number;
    items: ReadonlyMap<string, TodayItem>;
    openAtSnapshot: ReadonlySet<string>;
  };
  cleared: ReadonlyMap<string, number>;
}

export function toTodayView(row: FunctionReturnType<typeof todayApi.get>): TodayView | null {
  if (!row) return null;
  const { queue } = row;
  return {
    day: row.day,
    dayStart: row.dayStart,
    run: row.run,
    queue: queue && {
      snapshotAt: queue.snapshotAt, model: queue.model, brief: queue.brief, groups: queue.groups, readCount: queue.readCount,
      items: new Map(queue.items.map((item) => [item.conversationId as string, item])),
      openAtSnapshot: new Set(queue.openAtSnapshot),
    },
    cleared: new Map(row.cleared.map(({ conversationId, at }) => [conversationId as string, at])),
  };
}

export type TodayPlace =
  | { at: "ranked"; rank: number; group: string; reason: string }
  /** Queued, then handled: its rank stays as a gap. */
  | { at: "done"; rank: number; group: string; reason: string }
  | { at: "new" }
  | { at: "below" }
  | { at: "settled"; clearedAt: number }
  | { at: "out" };

/**
 * Where one live chat sits today. The list, the tab count, the header and the strip all read this.
 *
 * needsYou = known && flags.unresponded (message-based; an agent chat alone never counts).
 * handled  = cleared since the build's snapshot.
 *
 *   queued, Needs you at build:  needsYou && !handled → ranked | needsYou → new | else → done
 *   queued, Waiting at build:    waiting && !handled → ranked  | needsYou → new | else → done
 *   not queued, needsYou:        Needs you at build && !handled → below | else → new
 *   otherwise:                   cleared today → settled | else → out
 */
export function classifyToday(view: TodayView | null | undefined, chat: ChatSummary): TodayPlace {
  const id = chat.conversationId;
  const known = matchesFilters(chat, "all", "known");
  const clearedAt = id === undefined ? undefined : view?.cleared.get(id);
  const queue = view?.queue;
  const needsYou = known && chat.flags.unresponded;
  if (queue && id !== undefined) {
    const handled = clearedAt !== undefined && clearedAt >= queue.snapshotAt;
    const wasOpen = queue.openAtSnapshot.has(id);
    const item = queue.items.get(id);
    if (item) {
      const { rank, group, reason } = item;
      if (!handled && (wasOpen ? needsYou : known && chat.flags.waiting)) return { at: "ranked", rank, group, reason };
      return needsYou ? { at: "new" } : { at: "done", rank, group, reason };
    }
    if (needsYou) return wasOpen && !handled ? { at: "below" } : { at: "new" };
  }
  return known && clearedAt !== undefined && !chat.flags.unresponded && !chat.flags.waiting ? { at: "settled", clearedAt } : { at: "out" };
}

export type TodaySectionKey = "new" | `group:${string}` | "below" | "settled" | "fallback";

export interface TodayRowEntry {
  chat: ChatSummary;
  rank: number | null;
  reason: string | null;
}

export interface TodaySection {
  key: TodaySectionKey;
  label: string;
  detail: string | null;
  tone: "fresh" | null;
  /** Below the line and Settled today start folded. */
  foldable: boolean;
  rows: TodayRowEntry[];
}

export interface TodayPlan {
  /** fallback: no queue today, so one Needs you section in its usual order. */
  mode: "queue" | "fallback";
  sections: TodaySection[];
  /** Ranked plus New since. */
  toGo: number;
  newSince: number;
  /** Known conversations with a clear since the day began; a Regenerate never resets it. */
  settled: number;
}

export function todayTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { timeZone: TODAY_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

export function todayDate(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { timeZone: TODAY_TIME_ZONE, weekday: "long", month: "short", day: "numeric" });
}

const NEW_DETAIL = "Arrived after the queue was built. Newest first, not ranked.";
const BELOW_DETAIL = "Needs you threads left out today: closed loops, low stakes.";

const entry = (chat: ChatSummary): TodayRowEntry => ({ chat, rank: null, reason: null });
const newestFirst = (a: ChatSummary, b: ChatSummary) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0);

/** Buckets classifyToday over the directory. A held conversation that was handled keeps its slot (the desktop hold). */
export function planToday(view: TodayView | null | undefined, chats: readonly ChatSummary[], opts: { held: string | null }): TodayPlan {
  const settled = view ? chats.filter((chat) => chat.conversationId !== undefined && view.cleared.has(chat.conversationId) && matchesFilters(chat, "all", "known")).length : 0;
  const queue = view?.queue;
  if (!queue) {
    const open = chats.filter((chat) => chat.guid === opts.held || matchesFilters(chat, "unresponded", "known"));
    const rows = queueOrder(open).map(entry);
    const sections: TodaySection[] = rows.length ? [{ key: "fallback", label: "Needs you", detail: null, tone: null, foldable: false, rows }] : [];
    return { mode: "fallback", sections, toGo: rows.length, newSince: 0, settled };
  }

  const ranked = new Map<string, TodayRowEntry[]>();
  const fresh: ChatSummary[] = [];
  const below: ChatSummary[] = [];
  const done: { chat: ChatSummary; clearedAt: number }[] = [];
  let rankedCount = 0;
  for (const chat of chats) {
    const place = classifyToday(view, chat);
    switch (place.at) {
      case "done":
        if (chat.guid !== opts.held) break;
      // falls through: the held row stays where it was ranked
      case "ranked": {
        const rows = ranked.get(place.group) ?? [];
        rows.push({ chat, rank: place.rank, reason: place.reason });
        ranked.set(place.group, rows);
        if (place.at === "ranked") rankedCount++;
        break;
      }
      case "new":
        fresh.push(chat);
        break;
      case "below":
        below.push(chat);
        break;
      case "settled":
        done.push({ chat, clearedAt: place.clearedAt });
        break;
      case "out":
        break;
    }
  }
  const sections: TodaySection[] = [];
  if (fresh.length) {
    sections.push({ key: "new", label: `New since ${todayTime(queue.snapshotAt)}`, detail: NEW_DETAIL, tone: "fresh", foldable: false, rows: fresh.sort(newestFirst).map(entry) });
  }
  for (const group of queue.groups) {
    const rows = ranked.get(group.id);
    if (!rows?.length) continue;
    sections.push({ key: `group:${group.id}`, label: group.title, detail: group.context || null, tone: null, foldable: false, rows: rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)) });
  }
  if (below.length) sections.push({ key: "below", label: "Below the line", detail: BELOW_DETAIL, tone: null, foldable: true, rows: queueOrder(below).map(entry) });
  if (done.length) {
    sections.push({ key: "settled", label: "Settled today", detail: null, tone: null, foldable: true, rows: done.sort((a, b) => b.clearedAt - a.clearedAt).map(({ chat }) => entry(chat)) });
  }
  return { mode: "queue", sections, toGo: rankedCount + fresh.length, newSince: fresh.length, settled };
}

export type TodayBusy = "queued" | "building";

export type TodayHeader =
  | { kind: "loading" }
  | { kind: "unbuilt"; busy: TodayBusy | null }
  | { kind: "failed"; error: string; failedAt: number; busy: TodayBusy | null }
  | {
      kind: "queue"; builtAt: number; model: string; readCount: number; queued: number; brief: string;
      settled: number; toGo: number; cleared: boolean; newSince: number; busy: TodayBusy | null;
      /** A failed Regenerate over a good queue. */
      lastError: string | null;
    };

const MODEL_LABELS: Record<string, string> = { "claude-opus-5-5": "Opus 5.5" };
export const modelLabel = (model: string): string => MODEL_LABELS[model] ?? model;

function busyOf(run: TodayRun): TodayBusy | null {
  return run.status === "requested" ? "queued" : run.status === "building" ? "building" : null;
}

export function todayHeader(view: TodayView | null | undefined, plan: TodayPlan): TodayHeader {
  if (view === undefined) return { kind: "loading" };
  if (view === null) return { kind: "unbuilt", busy: null };
  const { run, queue } = view;
  const busy = busyOf(run);
  if (!queue) {
    return run.status === "failed"
      ? { kind: "failed", error: run.error, failedAt: run.failedAt, busy }
      : { kind: "unbuilt", busy };
  }
  return {
    kind: "queue", builtAt: queue.snapshotAt, model: modelLabel(queue.model), readCount: queue.readCount,
    queued: queue.items.size, brief: queue.brief, settled: plan.settled, toGo: plan.toGo,
    cleared: plan.toGo - plan.newSince === 0, newSince: plan.newSince, busy,
    lastError: run.status === "failed" ? run.error : null,
  };
}
