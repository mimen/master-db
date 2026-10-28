import { describe, expect, test } from "bun:test";
import type { TodayClaim, TodayOutcome, TodayPort, TodayRoutes } from "./build";
import { startTodayWorker, type PendingBuild } from "./worker";

function harness(claims: Record<number, number | null>, build: (claim: TodayClaim) => Promise<TodayOutcome>, buildTimeoutMs?: number) {
  let receive: (pending: PendingBuild | null) => void = () => undefined;
  const finished: TodayRoutes["todayFinish"][0][] = [];
  const claimed: number[] = [];
  const claimIds: string[] = [];
  const port: Pick<TodayPort, "post"> = {
    post: async <K extends keyof TodayRoutes>(route: K, body: TodayRoutes[K][0]) => {
      if (route === "todayClaim") {
        const { attempt, claimId } = body as TodayRoutes["todayClaim"][0];
        claimed.push(attempt);
        claimIds.push(claimId);
        const startedAt = claims[attempt] ?? null;
        return (startedAt === null ? null : { startedAt }) as TodayRoutes[K][1];
      }
      finished.push(body as TodayRoutes["todayFinish"][0]);
      return true as TodayRoutes[K][1];
    },
  };
  const worker = startTodayWorker({ subscribe: (r) => { receive = r; return () => { receive = () => undefined; }; }, port, build, log: () => undefined, buildTimeoutMs });
  return { worker, finished, claimed, claimIds, emit: (pending: PendingBuild | null) => receive(pending) };
}

const queue = { snapshotAt: 0, model: "m", brief: "b", groups: [], items: [], openAtSnapshot: [], readCount: 0 };

describe("startTodayWorker", () => {
  test("runs one build at a time and reads a request seen mid-build afterwards", async () => {
    let active = 0;
    let peak = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ 1: 10, 2: 20 }, async (claim) => {
      active++;
      peak = Math.max(peak, active);
      if (claim.attempt === 1) await gate;
      active--;
      return { ok: true, queue: { ...queue, snapshotAt: claim.startedAt } };
    });
    h.emit({ day: "d", attempt: 1 });
    await Bun.sleep(0);
    h.emit({ day: "d", attempt: 2 });
    release();
    await h.worker.idle();
    expect(peak).toBe(1);
    expect(h.claimed).toEqual([1, 2]);
    expect(new Set(h.claimIds).size).toBe(2);
    expect(h.finished.map((f) => [f.attempt, f.outcome.ok && f.outcome.queue.snapshotAt])).toEqual([[1, 10], [2, 20]]);
  });

  test("a fenced-out claim skips the build", async () => {
    let built = 0;
    const h = harness({ 1: null }, async () => { built++; return { ok: true, queue }; });
    h.emit({ day: "d", attempt: 1 });
    await h.worker.idle();
    expect(built).toBe(0);
    expect(h.finished).toEqual([]);
  });

  test("a thrown build posts a failed outcome", async () => {
    const h = harness({ 1: 5 }, async () => { throw new Error("Comma ingest todayCandidates HTTP 400"); });
    h.emit({ day: "d", attempt: 1 });
    await h.worker.idle();
    expect(h.finished).toEqual([{ day: "d", attempt: 1, outcome: { ok: false, error: "Comma ingest todayCandidates HTTP 400" } }]);
  });

  test("a build past the deadline posts failed and the next request is claimed", async () => {
    let release: () => void = () => undefined;
    const stuck = new Promise<void>((resolve) => { release = resolve; });
    const h = harness({ 1: 10, 2: 20 }, async (claim) => {
      if (claim.attempt === 1) await stuck;
      return { ok: true, queue };
    }, 20);
    h.emit({ day: "d", attempt: 1 });
    await Bun.sleep(0);
    h.emit({ day: "d", attempt: 2 });
    await h.worker.idle();
    release();
    await Bun.sleep(0);
    expect(h.finished.map((f) => [f.attempt, f.outcome])).toEqual([
      [1, { ok: false, error: "The build timed out" }],
      [2, { ok: true, queue }],
    ]);
  });

  test("stop unsubscribes", async () => {
    const h = harness({ 1: 5 }, async () => ({ ok: true, queue }));
    h.worker.stop();
    h.emit({ day: "d", attempt: 1 });
    await h.worker.idle();
    expect(h.claimed).toEqual([]);
  });
});
