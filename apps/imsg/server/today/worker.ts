import type { TodayClaim, TodayOutcome, TodayPort } from "./build";

export type PendingBuild = { day: string; attempt: number };

/**
 * Builds the Today queue whenever Convex shows a requested run. One build at a time, beside the outbox
 * executor rather than inside it, so a minute-long build never holds up a send. A request seen
 * mid-build is read again once the build ends; the claim fences out anything stale.
 */
export function startTodayWorker(deps: {
  subscribe: (receive: (pending: PendingBuild | null) => void) => () => void;
  port: Pick<TodayPort, "post">;
  build: (claim: TodayClaim) => Promise<TodayOutcome>;
  log?: (line: string) => void;
}): { stop(): void; idle(): Promise<void> } {
  const log = deps.log ?? ((line: string) => console.log(line));
  let latest: PendingBuild | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;

  async function runOne({ day, attempt }: PendingBuild): Promise<void> {
    const claim = await deps.port.post("todayClaim", { day, attempt });
    if (!claim) {
      log(`today: ${day} attempt ${attempt} belongs to another worker`);
      return;
    }
    let outcome: TodayOutcome;
    try {
      outcome = await deps.build({ day, attempt, startedAt: claim.startedAt });
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    await deps.port.post("todayFinish", { day, attempt, outcome });
    log(`today: ${day} attempt ${attempt} ${outcome.ok ? `built, ${outcome.queue.items.length} items` : `failed: ${outcome.error}`}`);
  }

  async function drain(): Promise<void> {
    while (latest && !stopped) {
      const job = latest;
      latest = null;
      await runOne(job).catch((error) => log(`today: ${job.day} attempt ${job.attempt}: ${String(error)}`));
    }
    running = null;
  }

  const unsubscribe = deps.subscribe((pending) => {
    latest = pending;
    if (pending && !running && !stopped) running = drain();
  });

  return {
    stop() {
      stopped = true;
      unsubscribe();
    },
    idle: async () => { await running; },
  };
}
