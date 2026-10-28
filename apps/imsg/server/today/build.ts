import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { internal } from "../../../../convex/_generated/api";
import { TODAY_LIMITS, TODAY_SETTLE_GROUP } from "../../shared/today";
import type { Gateway, GatewayFailureKind, GatewayResult } from "../ai/gateway";
import type { ConvexIngest } from "../bridge/convex-ingest";
import type { OverlayDb } from "../db";
import { cardThread, emptyCardStats, type CardStats } from "./cards";
import {
  parseTodayOutput, renderTodayPrompt, renderUpdateTurn, TODAY_SCHEMA,
  type ConversationId, type TodayCandidate, type TodayCardedThread, type TodayDraft,
} from "./prompt";
import {
  compactSession, estimateTokens, planUpdate, TODAY_COMPACT_AT_TOKENS, TODAY_MODEL, TODAY_SESSION_MAX_TOKENS,
  type TodaySession, type TodaySessionThread, type TodayTurn,
} from "./session";

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

export type TodayClaim = { day: string; attempt: number } & NonNullable<TodayRoutes["todayClaim"][1]>;
export type TodayMode = TodayClaim["mode"];
export type TodayOutcome = TodayRoutes["todayFinish"][0]["outcome"];
export type TodayQueueInput = Extract<TodayOutcome, { ok: true }>["queue"];
/**
 * A build's outcome, and what to persist once todayFinish accepts it: the rotation's read times and the session.
 * `compact` is set when the saved session has grown past the compaction threshold.
 */
export type TodayBuild = { outcome: TodayOutcome; accept: () => void; compact?: (signal: AbortSignal) => Promise<void> };

const PAGE_SIZE = 100;
const CONCURRENCY = 12;
const DEEP_MS = 30 * 86_400_000;
/**
 * New card calls stop starting after this, and the rest fall back to raw messages, so a slow card model
 * cannot spend the worker's 7 minutes. An uncached pass over 194 threads took 47 s on the Mini.
 */
const CARD_BUDGET_MS = 120_000;

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
  /** The Overlay's Today tables: last-read times for the rotation, the card cache, and the model sessions. */
  store: Pick<OverlayDb, "todayReadAt" | "markTodayRead" | "getTodayCard" | "setTodayCard" | "getTodaySession" | "setTodaySession">;
  profile: () => Promise<string>;
  now: () => number;
  log?: (line: string) => void;
}

async function readCandidates(port: TodayBuildDeps["port"], signal: AbortSignal): Promise<TodayCandidate[]> {
  const all: TodayCandidate[] = [];
  let cursor: string | null = null;
  for (;;) {
    signal.throwIfAborted();
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
  mode: TodayMode;
  candidates: { needsYou: number; waiting: number };
  /** A fresh build's selection (recent, rotated, waiting), or an Update's plan (fresh, deeper, gone, room). */
  read: Record<string, number>;
  cards: CardStats;
  cardMs: number;
  reduce: { input: number | null; output: number | null; ms: number };
  items: number;
  settle: number;
  deep: number;
  /** An Update's session size after the turn. */
  tokens?: number;
}

export function buildLogLine(stats: TodayBuildStats): string {
  const { candidates, read, cards, reduce } = stats;
  return `today: build mode=${stats.mode} candidates needsYou=${candidates.needsYou} waiting=${candidates.waiting}`
    + ` · read ${Object.entries(read).map(([key, count]) => `${key}=${count}`).join(" ")}`
    + ` · cards reused=${cards.reused} computed=${cards.computed} escalated=${cards.escalated} failed=${cards.failed} ms=${stats.cardMs}`
    + ` · reduce in=${reduce.input ?? "?"} out=${reduce.output ?? "?"} ms=${reduce.ms}`
    + ` · items=${stats.items} settle=${stats.settle} deep=${stats.deep}${stats.tokens === undefined ? "" : ` tokens=${stats.tokens}`}`;
}

const nothingToAccept = (outcome: TodayOutcome): TodayBuild => ({ outcome, accept: () => undefined });

const needsYouIds = (candidates: readonly TodayCandidate[]) => candidates.filter((c) => c.state === "needsYou").map((c) => c.conversationId);

/** Fetches each thread's last messages and people, then cards it, within the card budget. */
async function cardThreads(deps: TodayBuildDeps, signal: AbortSignal, read: readonly { ref: string; candidate: TodayCandidate }[]) {
  const cards = emptyCardStats();
  const started = performance.now();
  const cardDeps = { ...deps, signal, budgetLeftMs: () => started + CARD_BUDGET_MS - performance.now() };
  const threads: TodayCardedThread[] = await mapLimit(read, CONCURRENCY, async ({ ref, candidate }) => {
    signal.throwIfAborted();
    const [context, people] = await Promise.all([
      deps.port.post("agentContext", { conversationId: candidate.conversationId, limit: TODAY_LIMITS.messages }),
      deps.port.post("agentPeople", { conversationId: candidate.conversationId }),
    ]);
    const thread = { ref, candidate, people, messages: context.messages };
    return { ...thread, card: await cardThread(cardDeps, thread, cards) };
  });
  return { threads, cards, cardMs: Math.round(performance.now() - started) };
}

/** The one Opus 5.5 call: a fresh read, or the next turn of a session. */
async function reduce(deps: TodayBuildDeps, signal: AbortSignal, prompt: string, system: string, history?: readonly TodayTurn[]) {
  signal.throwIfAborted();
  const started = performance.now();
  const answer = await deps.gateway.completeStructured<unknown>(prompt, TODAY_SCHEMA, {
    model: TODAY_MODEL, system, ...(history ? { history } : {}), maxTokens: 16_000, timeoutMs: 300_000, effort: "medium", signal,
  });
  signal.throwIfAborted();
  if (!answer.ok) deps.log?.(`today: gateway ${answer.error.kind}: ${answer.error.message}`);
  return { answer, ms: Math.round(performance.now() - started) };
}

/** Parses the answer against the refs it may use, and anchors each item to the newest message read for it. */
function draftFrom(deps: TodayBuildDeps, value: unknown, refs: ReadonlyMap<string, ConversationId>, anchor: (id: ConversationId) => string | undefined):
  { ok: true; draft: Omit<TodayDraft, "dropped"> } | { ok: false; error: string } {
  const parsed = parseTodayOutput(value, refs);
  if (!parsed.ok) return parsed;
  const { dropped, ...draft } = parsed.draft;
  if (dropped > 0) deps.log?.(`today: dropped ${dropped} items the parser rejected`);
  return { ok: true, draft: { ...draft, items: draft.items.map((item) => {
    const guid = anchor(item.conversationId);
    return guid === undefined ? item : { ...item, anchor: guid };
  }) } };
}

function sessionThread(thread: TodayCardedThread): TodaySessionThread {
  const anchor = thread.messages.at(-1)?.guid;
  return { ref: thread.ref, lastMessageAt: thread.candidate.lastMessageAt, state: thread.candidate.state, ...(anchor === undefined ? {} : { anchor }) };
}

/** The session's size after a call: its usage, or an estimate when the gateway reported none. */
const sizeAfter = (answer: Extract<GatewayResult<unknown>, { ok: true }>, estimate: () => number): number =>
  answer.usage ? answer.usage.input + answer.usage.output : estimate();

function draftStats(draft: Omit<TodayDraft, "dropped">, candidates: readonly TodayCandidate[], now: number) {
  const deep = new Set(candidates.filter((c) => now - c.lastMessageAt > DEEP_MS).map((c) => c.conversationId));
  const needsYou = candidates.filter((c) => c.state === "needsYou").length;
  return {
    candidates: { needsYou, waiting: candidates.length - needsYou },
    items: draft.items.length,
    settle: draft.items.filter((item) => item.group === TODAY_SETTLE_GROUP).length,
    deep: draft.items.filter((item) => deep.has(item.conversationId)).length,
  };
}

/** Once todayFinish takes the queue: the threads read this turn get their read time, and the session is saved. */
function accepting(deps: TodayBuildDeps, signal: AbortSignal, queue: TodayQueueInput, read: readonly TodayCardedThread[], session: TodaySession): TodayBuild {
  return {
    outcome: { ok: true, queue },
    accept: () => {
      if (signal.aborted) return;
      deps.store.markTodayRead(read.map((thread) => thread.candidate.conversationId), session.snapshotAt);
      deps.store.setTodaySession(session);
    },
    ...(session.tokens >= TODAY_COMPACT_AT_TOKENS ? { compact: (compaction: AbortSignal) => compactSession(deps, session, compaction) } : {}),
  };
}

/** A fresh read: the bounded rotating selection, carded, reduced in one call, and the start of a new session. */
async function buildFresh(deps: TodayBuildDeps, claim: TodayClaim, signal: AbortSignal, candidates: readonly TodayCandidate[]): Promise<TodayBuild> {
  const now = deps.now();
  const selection = selectToday(candidates, deps.store.todayReadAt(), now);
  const read = [...selection.recent, ...selection.rotated, ...selection.waiting];
  const base = { snapshotAt: claim.startedAt, model: TODAY_MODEL, openAtSnapshot: needsYouIds(candidates), readCount: read.length, candidateCount: candidates.length };
  if (read.length === 0) return nothingToAccept({ ok: true, queue: { ...base, brief: "Nothing needs you right now.", groups: [], items: [] } });

  const { threads, cards, cardMs } = await cardThreads(deps, signal, read.map((candidate, index) => ({ ref: `c${index + 1}`, candidate })));
  const byCandidate = new Map(threads.map((thread) => [thread.candidate, thread]));
  const oldestFirst = (list: readonly TodayCandidate[]) => [...list].sort((a, b) => a.lastMessageAt - b.lastMessageAt).map((c) => byCandidate.get(c)!);
  const dropOrder = [...oldestFirst(selection.rotated), ...oldestFirst(selection.waiting), ...oldestFirst(selection.recent)];
  const { system, prompt, kept } = renderTodayPrompt({ threads, profile: await deps.profile(), now, dropOrder });
  if (kept.length < threads.length) deps.log?.(`today: dropped ${threads.length - kept.length} threads to fit the reduce prompt`);
  const { answer, ms } = await reduce(deps, signal, prompt, system);
  if (!answer.ok) return nothingToAccept({ ok: false, error: FAILURE_COPY[answer.error.kind] });
  const anchors = new Map(threads.map((thread) => [thread.candidate.conversationId, thread.messages.at(-1)?.guid]));
  const parsed = draftFrom(deps, answer.value, new Map(kept.map((thread) => [thread.ref, thread.candidate.conversationId])), (id) => anchors.get(id));
  if (!parsed.ok) return nothingToAccept(parsed);
  const { draft } = parsed;

  const reply = JSON.stringify(answer.value);
  const session: TodaySession = {
    id: crypto.randomUUID(), startedAt: claim.startedAt, snapshotAt: claim.startedAt, arrivalsSince: claim.startedAt, day: claim.day, updates: 0, system,
    turns: [{ role: "user", content: prompt }, { role: "assistant", content: reply }],
    tokens: sizeAfter(answer, () => estimateTokens(system + prompt + reply)), compactions: 0, nextRef: read.length + 1,
    threads: Object.fromEntries(kept.map((thread) => [thread.candidate.conversationId, sessionThread(thread)])),
    items: draft.items.map((item) => item.conversationId),
  };
  deps.log?.(buildLogLine({
    mode: "fresh", read: { recent: selection.recent.length, rotated: selection.rotated.length, waiting: selection.waiting.length },
    cards, cardMs, reduce: { input: answer.usage?.input ?? null, output: answer.usage?.output ?? null, ms }, ...draftStats(draft, candidates, now),
  }));
  const queue = { ...base, readCount: kept.length, ...draft, session: { id: session.id, startedAt: session.startedAt, updates: 0 } };
  return accepting(deps, signal, queue, kept, session);
}

type Fallback = "no basis" | "no session" | "session mismatch" | "session too large";

/** The session an Update continues, or why it cannot. */
function resume(store: TodayBuildDeps["store"], claim: TodayClaim): TodaySession | Fallback {
  if (!claim.basis) return "no basis";
  const session = store.getTodaySession(claim.basis.sessionId);
  if (!session) return "no session";
  if (session.snapshotAt !== claim.basis.snapshotAt) return "session mismatch";
  return session.tokens > TODAY_SESSION_MAX_TOKENS ? "session too large" : session;
}

/**
 * The next turn of the session: only what changed since it last read, plus enough of the unread backlog to fill the
 * room. The model is always called, since the clock alone changes what is due.
 */
async function buildUpdate(deps: TodayBuildDeps, claim: TodayClaim, signal: AbortSignal, candidates: readonly TodayCandidate[], session: TodaySession): Promise<TodayBuild | Fallback> {
  const newDay = claim.day !== session.day;
  const plan = planUpdate(session, candidates, deps.store.todayReadAt(), newDay);
  let nextRef = session.nextRef;
  const read = [...plan.fresh, ...plan.deeper].map((candidate) => ({ ref: session.threads[candidate.conversationId]?.ref ?? `c${nextRef++}`, candidate }));
  const { threads, cards, cardMs } = await cardThreads(deps, signal, read);
  const now = deps.now();
  const turn = renderUpdateTurn({ threads, gone: plan.gone, open: plan.open, room: plan.room, now, since: session.snapshotAt, newDay });
  if (session.tokens + estimateTokens(turn) > TODAY_SESSION_MAX_TOKENS) return "session too large";
  const { answer, ms } = await reduce(deps, signal, turn, session.system, session.turns);
  if (!answer.ok) return nothingToAccept({ ok: false, error: FAILURE_COPY[answer.error.kind] });

  const current = new Set<string>(candidates.map((c) => c.conversationId));
  const threadsNow: Record<string, TodaySessionThread> = {
    ...Object.fromEntries(Object.entries(session.threads).filter(([id]) => current.has(id))),
    ...Object.fromEntries(threads.map((thread) => [thread.candidate.conversationId, sessionThread(thread)])),
  };
  const refs = new Map(Object.entries(threadsNow).map(([id, thread]) => [thread.ref, id as ConversationId]));
  const parsed = draftFrom(deps, answer.value, refs, (id) => threadsNow[id]?.anchor);
  if (!parsed.ok) return nothingToAccept(parsed);
  const { draft } = parsed;

  const reply = JSON.stringify(answer.value);
  const next: TodaySession = {
    ...session, snapshotAt: claim.startedAt, arrivalsSince: plan.freshCut ? session.arrivalsSince : claim.startedAt, day: claim.day,
    updates: session.updates + 1,
    turns: [...session.turns, { role: "user", content: turn }, { role: "assistant", content: reply }],
    tokens: sizeAfter(answer, () => session.tokens + estimateTokens(turn + reply)), nextRef, threads: threadsNow,
    items: draft.items.map((item) => item.conversationId),
  };
  deps.log?.(buildLogLine({
    mode: "update", read: { fresh: plan.fresh.length, deeper: plan.deeper.length, gone: plan.gone.length, room: plan.room },
    cards, cardMs, reduce: { input: answer.usage?.input ?? null, output: answer.usage?.output ?? null, ms }, ...draftStats(draft, candidates, now),
    tokens: next.tokens,
  }));
  const queue: TodayQueueInput = {
    snapshotAt: claim.startedAt, model: TODAY_MODEL, openAtSnapshot: needsYouIds(candidates), readCount: refs.size, candidateCount: candidates.length,
    ...draft, session: { id: session.id, startedAt: session.startedAt, updates: next.updates },
  };
  return accepting(deps, signal, queue, threads, next);
}

/**
 * Reads every candidate and builds the day's queue. An Update continues the claim's session when it can, and builds
 * fresh otherwise. Once `signal` aborts, no new call starts and nothing is written; it throws instead.
 */
export async function buildToday(deps: TodayBuildDeps, claim: TodayClaim, signal: AbortSignal = new AbortController().signal): Promise<TodayBuild> {
  if (!deps.gateway.available) return nothingToAccept({ ok: false, error: "AI gateway not configured" });
  const candidates = await readCandidates(deps.port, signal);
  if (claim.mode === "update") {
    const session = resume(deps.store, claim);
    const update = typeof session === "string" ? session : await buildUpdate(deps, claim, signal, candidates, session);
    if (typeof update !== "string") return update;
    deps.log?.(`today: update fell back to fresh: ${update}`);
  }
  return await buildFresh(deps, claim, signal, candidates);
}
