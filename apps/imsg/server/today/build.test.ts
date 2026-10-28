import { describe, expect, test } from "bun:test";
import type { GatewayResult, StructuredOptions } from "../ai/gateway";
import { buildToday, type TodayBuildDeps, type TodayRoutes } from "./build";
import type { ConversationId, TodayCandidate } from "./prompt";

const claim = { day: "2026-10-27", attempt: 1, startedAt: 1_000 };

function candidate(n: number, state: TodayCandidate["state"]): TodayCandidate {
  return { conversationId: `conv${n}` as ConversationId, title: `Person ${n}`, isGroup: false, state, lastMessageAt: 10_000 - n, unreadCount: 0 };
}

function fakes(candidates: TodayCandidate[], answer: (prompt: string) => GatewayResult<unknown>, opts: { available?: boolean } = {}) {
  const calls: { prompt: string; options: StructuredOptions }[] = [];
  const posts: string[] = [];
  const port: TodayBuildDeps["port"] = {
    post: async <K extends keyof TodayRoutes>(route: K, body: TodayRoutes[K][0]) => {
      posts.push(route);
      if (route === "todayCandidates") {
        const { cursor } = body as TodayRoutes["todayCandidates"][0];
        const start = Number(cursor ?? 0);
        const page = candidates.slice(start, start + 100);
        return { page, continueCursor: String(start + 100), isDone: start + 100 >= candidates.length } as TodayRoutes[K][1];
      }
      if (route === "agentContext") return { title: "t", participants: [], messages: [] } as TodayRoutes[K][1];
      if (route === "agentPeople") return [] as TodayRoutes[K][1];
      throw new Error(`unexpected ${route}`);
    },
  };
  const deps: TodayBuildDeps = {
    port,
    gateway: {
      available: opts.available ?? true,
      completeStructured: async <T,>(prompt: string, _schema: unknown, options: StructuredOptions) => {
        calls.push({ prompt, options });
        return answer(prompt) as GatewayResult<T>;
      },
    },
    profile: async () => "profile",
    now: () => 20_000,
  };
  return { deps, calls, posts };
}

const firstItem = (prompt: string) => ({
  ok: true as const,
  value: { brief: "Friday first.", groups: [{ id: "g", title: "Friday", context: "Tonight." }], items: [{ ref: prompt.match(/ref="(c\d+)"/)![1], group: "g", reason: "Clock today." }] },
});

describe("buildToday", () => {
  test("makes exactly one Opus 5.5 call and stamps the queue with the claim time", async () => {
    const { deps, calls } = fakes([candidate(1, "needsYou"), candidate(2, "waiting")], firstItem);
    const outcome = await buildToday(deps, claim);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({ model: "claude-opus-5-5", effort: "medium", maxTokens: 16_000, timeoutMs: 300_000 });
    expect(calls[0]?.options.system).toContain("profile");
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.queue).toMatchObject({ snapshotAt: 1_000, model: "claude-opus-5-5", readCount: 2, openAtSnapshot: ["conv1"] });
    expect(outcome.queue.items).toEqual([{ conversationId: "conv1" as ConversationId, rank: 1, group: "g", reason: "Clock today." }]);
  });

  test("the read cap keeps every Needs you id in openAtSnapshot and reads Needs you before Waiting", async () => {
    const list = [
      ...Array.from({ length: 30 }, (_, n) => candidate(n, "waiting")),
      ...Array.from({ length: 130 }, (_, n) => candidate(100 + n, "needsYou")),
    ];
    const { deps, calls } = fakes(list, firstItem);
    const outcome = await buildToday(deps, claim);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.queue.readCount).toBe(120);
    expect(outcome.queue.openAtSnapshot).toHaveLength(130);
    expect(calls[0]?.prompt).not.toContain('state="waiting"');
  });

  test("maps a gateway failure to header copy", async () => {
    const { deps } = fakes([candidate(1, "needsYou")], () => ({ ok: false, error: { kind: "timeout", message: "x", status: null, retryAfterMs: null } }));
    expect(await buildToday(deps, claim)).toEqual({ ok: false, error: "The gateway timed out" });
  });

  test("fails fast without a gateway key, before reading anything", async () => {
    const { deps, posts, calls } = fakes([candidate(1, "needsYou")], firstItem, { available: false });
    expect(await buildToday(deps, claim)).toEqual({ ok: false, error: "AI gateway not configured" });
    expect(posts).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("an empty day builds an empty queue without calling the model", async () => {
    const { deps, calls } = fakes([], firstItem);
    const outcome = await buildToday(deps, claim);
    expect(outcome).toMatchObject({ ok: true, queue: { items: [], groups: [], readCount: 0 } });
    expect(calls).toEqual([]);
  });
});
