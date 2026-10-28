import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { internal } from "../../../../convex/_generated/api";
import { TODAY_LIMITS, TODAY_SETTLE_GROUP } from "../../shared/today";
import type { Gateway, GatewayFailureKind } from "../ai/gateway";
import type { ConvexIngest } from "../bridge/convex-ingest";
import type { OverlayDb } from "../db";
import { cardThread, emptyCardStats, type CardStats } from "./cards";
import { parseTodayOutput, renderTodayPrompt, TODAY_SCHEMA, type ConversationId, type TodayCandidate, type TodayCardedThread } from "./prompt";

type Refs = Pick<typeof internal.comma.today, "todaySchedule" | "todayClaim" | "todayCandidates" | "todayFinish">
  & Pick<typeof internal.comma.agentContext, "agentContext" | "agentPeople">;
export type TodayRoutes = { [K in keyof Refs]: [FunctionArgs<Refs[K]>, FunctionReturnType<Refs[K]>] };

/** The ingest routes the Today worker, build and trigger post to, each the internal mutation of the same name. */
export interface TodayPort {
  post<K extends keyof TodayRoutes>(route: K, body: TodayRoutes[K][0]): Promise<TodayRoutes[K][1]>;
}

export function todayPort(ingest: Pick<ConvexIngest, "request">): TodayPort {
  return { post: (route, body) => ingest.request(route, body) };
}

export type TodayClaim = { day: string; attempt: number; startedAt: number };
export type TodayOutcome = TodayRoutes["todayFinish"][0]["outcome"];
export type TodayQueueInput = Extract<TodayOutcome, { ok: true }>["queue"];

export const TODAY_MODEL = "claude-opus-5-5";
const PAGE_SIZE = 100;
const CONCURRENCY = 12;
const DEEP_MS = 30 * 86_400_000;

export const FAILURE_COPY: Record<GatewayFailureKind, string> = {
  timeout: "The gateway timed out",
  provider: "Opus 5.5 was unavailable",
  "invalid-output": "The answer didn't parse",
  "schema-unsupported": "The answer didn't parse",
  shared: "The AI gateway is down",
};

export interface TodayBuildDeps {
  port: Pick<TodayPort, "post">;
  gateway: Pick<Gateway, "available" | "completeStructured">;
  /** The Overlay's Today tables: last-read times for the rotation, and the card cache. */
  store: Pick<OverlayDb, "todayReadAt" | "markTodayRead" | "getTodayCard" | "setTodayCard">;
  profile: () => Promise<string>;
  now: () => number;
  log?: (line: string) => void;
}

async function readCandidates(port: TodayBuildDeps["port"]): Promise<TodayCandidate[]> {
  const all: TodayCandidate[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: TodayRoutes["todayCandidates"][1] = await port.post("todayCandidates", { cursor, numItems: PAGE_SIZE });
    all.push(...result.page);
    if (result.isDone) return all;
    cursor = result.continueCursor;
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!, index);
    }
  }));
  return results;
}

export interface TodaySelection {
  recent: TodayCandidate[];
  rotated: TodayCandidate[];
  waiting: TodayCandidate[];
}

const newestFirst = (a: TodayCandidate, b: TodayCandidate) => b.lastMessageAt - a.lastMessageAt;

/**
 * The bounded, rotating read: the newest Needs you under 30 days first, then the rest of the Needs you backlog least
 * recently read first (never read counts as oldest), then the newest Waiting.
 */
export function selectToday(candidates: readonly TodayCandidate[], lastRead: ReadonlyMap<string, number>, now: number): TodaySelection {
  const needsYou = candidates.filter((c) => c.state === "needsYou").sort(newestFirst);
  const recent = needsYou.filter((c) => now - c.lastMessageAt < TODAY_LIMITS.recentMaxAgeMs).slice(0, TODAY_LIMITS.recent);
  const taken = new Set(recent);
  const readAt = (c: TodayCandidate) => lastRead.get(c.conversationId) ?? 0;
  const rotated = needsYou.filter((c) => !taken.has(c))
    .sort((a, b) => readAt(a) - readAt(b) || newestFirst(a, b))
    .slice(0, TODAY_LIMITS.needsYou - recent.length);
  const waiting = candidates.filter((c) => c.state === "waiting").sort(newestFirst).slice(0, TODAY_LIMITS.waiting);
  return { recent, rotated, waiting };
}

export interface TodayBuildStats {
  candidates: { needsYou: number; waiting: number };
  read: { recent: number; rotated: number; waiting: number };
  cards: CardStats;
  cardMs: number;
  reduce: { input: number | null; output: number | null; ms: number };
  items: number;
  settle: number;
  deep: number;
}

export function buildLogLine(stats: TodayBuildStats): string {
  const { candidates, read, cards, reduce } = stats;
  return `today: build candidates needsYou=${candidates.needsYou} waiting=${candidates.waiting}`
    + ` · read recent=${read.recent} rotated=${read.rotated} waiting=${read.waiting}`
    + ` · cards reused=${cards.reused} computed=${cards.computed} escalated=${cards.escalated} failed=${cards.failed} ms=${stats.cardMs}`
    + ` · reduce in=${reduce.input ?? "?"} out=${reduce.output ?? "?"} ms=${reduce.ms}`
    + ` · items=${stats.items} settle=${stats.settle} deep=${stats.deep}`;
}

/** Reads every candidate, cards a bounded rotating selection with Haiku, reduces the cards with one Opus 5.5 call, and returns the day's queue. */
export async function buildToday(deps: TodayBuildDeps, claim: TodayClaim): Promise<TodayOutcome> {
  if (!deps.gateway.available) return { ok: false, error: "AI gateway not configured" };
  const candidates = await readCandidates(deps.port);
  const now = deps.now();
  const openAtSnapshot = candidates.filter((c) => c.state === "needsYou").map((c) => c.conversationId);
  const selection = selectToday(candidates, deps.store.todayReadAt(), now);
  const read = [...selection.recent, ...selection.rotated, ...selection.waiting];
  const base = { snapshotAt: claim.startedAt, model: TODAY_MODEL, openAtSnapshot, readCount: read.length };
  if (read.length === 0) return { ok: true, queue: { ...base, brief: "Nothing needs you right now.", groups: [], items: [] } };

  const cards = emptyCardStats();
  const cardsStarted = performance.now();
  const threads: TodayCardedThread[] = await mapLimit(read, CONCURRENCY, async (candidate, index) => {
    const [context, people] = await Promise.all([
      deps.port.post("agentContext", { conversationId: candidate.conversationId, limit: TODAY_LIMITS.messages }),
      deps.port.post("agentPeople", { conversationId: candidate.conversationId }),
    ]);
    const thread = { ref: `c${index + 1}`, candidate, people, messages: context.messages };
    return { ...thread, card: await cardThread(deps, thread, cards) };
  });
  const cardMs = Math.round(performance.now() - cardsStarted);

  const { system, prompt } = renderTodayPrompt({ threads, profile: await deps.profile(), now });
  const reduceStarted = performance.now();
  const answer = await deps.gateway.completeStructured<unknown>(prompt, TODAY_SCHEMA, {
    model: TODAY_MODEL, system, maxTokens: 16_000, timeoutMs: 300_000, effort: "medium",
  });
  const reduceMs = Math.round(performance.now() - reduceStarted);
  if (!answer.ok) {
    deps.log?.(`today: gateway ${answer.error.kind}: ${answer.error.message}`);
    return { ok: false, error: FAILURE_COPY[answer.error.kind] };
  }
  const refs = new Map<string, ConversationId>(threads.map((thread) => [thread.ref, thread.candidate.conversationId]));
  const parsed = parseTodayOutput(answer.value, refs);
  if (!parsed.ok) return parsed;
  const { dropped, ...draft } = parsed.draft;
  if (dropped > 0) deps.log?.(`today: dropped ${dropped} items the parser rejected`);
  deps.store.markTodayRead(read.map((c) => c.conversationId), claim.startedAt);

  const deep = new Set(read.filter((c) => now - c.lastMessageAt > DEEP_MS).map((c) => c.conversationId));
  deps.log?.(buildLogLine({
    candidates: { needsYou: openAtSnapshot.length, waiting: candidates.length - openAtSnapshot.length },
    read: { recent: selection.recent.length, rotated: selection.rotated.length, waiting: selection.waiting.length },
    cards, cardMs,
    reduce: { input: answer.usage?.input ?? null, output: answer.usage?.output ?? null, ms: reduceMs },
    items: draft.items.length,
    settle: draft.items.filter((item) => item.group === TODAY_SETTLE_GROUP).length,
    deep: draft.items.filter((item) => deep.has(item.conversationId)).length,
  }));
  return { ok: true, queue: { ...base, ...draft } };
}
