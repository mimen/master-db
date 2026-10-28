import { describe, expect, test } from "bun:test";
import type { TodayPort, TodayRoutes } from "./build";
import { awaitScheduledBuild } from "./trigger";

type Run = TodayRoutes["todaySchedule"][1];
const day = { day: "2026-10-27", dayStart: 0 };
const requested: Run = { status: "requested", attempt: 1, source: "schedule", requestedAt: 0 };
const building: Run = { status: "building", attempt: 1, source: "schedule", requestedAt: 0, startedAt: 1, claimId: "w1" };

function port(runs: (Run | Error)[]): Pick<TodayPort, "post"> & { polls: number } {
  const p = {
    polls: 0,
    post: async <K extends keyof TodayRoutes>(): Promise<TodayRoutes[K][1]> => {
      const next = runs[Math.min(p.polls++, runs.length - 1)]!;
      if (next instanceof Error) throw next;
      return next as TodayRoutes[K][1];
    },
  };
  return p;
}

const opts = { pollMs: 5_000, timeoutMs: 20_000, sleep: async () => undefined, log: () => undefined };

describe("awaitScheduledBuild", () => {
  test("done exits 0", async () => {
    const p = port([requested, building, { status: "done", attempt: 1, source: "schedule", finishedAt: 2 }]);
    expect(await awaitScheduledBuild(p, day, opts)).toBe("done");
    expect(p.polls).toBe(3);
  });

  test("failed exits 1", async () => {
    expect(await awaitScheduledBuild(port([requested, { status: "failed", attempt: 1, source: "schedule", failedAt: 2, error: "The gateway timed out" }]), day, opts)).toBe("failed");
  });

  test("a run that never finishes times out as failed", async () => {
    const p = port([building]);
    expect(await awaitScheduledBuild(p, day, opts)).toBe("failed");
    expect(p.polls).toBe(5);
  });

  test("a failed poll keeps waiting", async () => {
    expect(await awaitScheduledBuild(port([new Error("offline"), { status: "done", attempt: 1, source: "schedule", finishedAt: 2 }]), day, opts)).toBe("done");
  });
});
