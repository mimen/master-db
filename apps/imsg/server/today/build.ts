import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { internal } from "../../../../convex/_generated/api";
import { TODAY_LIMITS } from "../../shared/today";
import type { Gateway, GatewayFailureKind } from "../ai/gateway";
import type { ConvexIngest } from "../bridge/convex-ingest";
import { parseTodayOutput, renderTodayPrompt, TODAY_SCHEMA, type ConversationId, type TodayCandidate, type TodayThread } from "./prompt";

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
const CONCURRENCY = 8;

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

/** Reads every candidate, makes one Opus 5.5 call over the newest TODAY_LIMITS.read of them, and returns the day's queue. */
export async function buildToday(deps: TodayBuildDeps, claim: TodayClaim): Promise<TodayOutcome> {
  if (!deps.gateway.available) return { ok: false, error: "AI gateway not configured" };
  const candidates = await readCandidates(deps.port);
  // Pages arrive newest first; the cap keeps every Needs you ahead of any Waiting.
  const ordered = [...candidates.filter((c) => c.state === "needsYou"), ...candidates.filter((c) => c.state === "waiting")];
  const openAtSnapshot = ordered.filter((c) => c.state === "needsYou").map((c) => c.conversationId);
  const read = ordered.slice(0, TODAY_LIMITS.read);
  const base = { snapshotAt: claim.startedAt, model: TODAY_MODEL, openAtSnapshot, readCount: read.length };
  if (read.length === 0) return { ok: true, queue: { ...base, brief: "Nothing needs you right now.", groups: [], items: [] } };

  const threads: TodayThread[] = await mapLimit(read, CONCURRENCY, async (candidate, index) => {
    const [context, people] = await Promise.all([
      deps.port.post("agentContext", { conversationId: candidate.conversationId, limit: TODAY_LIMITS.messages }),
      deps.port.post("agentPeople", { conversationId: candidate.conversationId }),
    ]);
    return { ref: `c${index + 1}`, candidate, people, messages: context.messages };
  });
  const { system, prompt } = renderTodayPrompt({ threads, profile: await deps.profile(), now: deps.now() });
  const answer = await deps.gateway.completeStructured<unknown>(prompt, TODAY_SCHEMA, {
    model: TODAY_MODEL, system, maxTokens: 16_000, timeoutMs: 300_000, effort: "medium",
  });
  if (!answer.ok) {
    deps.log?.(`today: gateway ${answer.error.kind}: ${answer.error.message}`);
    return { ok: false, error: FAILURE_COPY[answer.error.kind] };
  }
  const refs = new Map<string, ConversationId>(threads.map((thread) => [thread.ref, thread.candidate.conversationId]));
  const parsed = parseTodayOutput(answer.value, refs);
  if (!parsed.ok) return parsed;
  const { dropped, ...draft } = parsed.draft;
  if (dropped > 0) deps.log?.(`today: dropped ${dropped} items the parser rejected`);
  return { ok: true, queue: { ...base, ...draft } };
}
