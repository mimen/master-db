import type { TodayBuild, TodayClaim, TodayPort } from "./build";

export type PendingBuild = { day: string; attempt: number };

const BUILD_TIMEOUT_MS = 7 * 60_000;

/**
 * Builds the Today queue whenever Convex shows a requested run. One build at a time, beside the outbox
 * executor rather than inside it, so a minute-long build never holds up a send. A request seen
 * mid-build is read again once the build ends; the claim fences out anything stale. After an accepted
 * build that grew its session past the threshold, the session is compacted before the next job; a new
 * request or stop aborts that, so a pressed Update never waits on it.
 */
export function startTodayWorker(deps: {
  subscribe: (receive: (pending: PendingBuild | null) => void) => () => void;
  port: Pick<TodayPort, "post">;
  /** Aborted when the deadline abandons the attempt or the worker stops; an aborted build writes nothing. */
  build: (claim: TodayClaim, signal: AbortSignal) => Promise<TodayBuild>;
  log?: (line: string) => void;
  /** Under Convex's 8-minute building expiry, so a Regenerate after it is claimed instead of waiting on a stuck build. */
  buildTimeoutMs?: number;
}): { stop(): void; idle(): Promise<void> } {
  const log = deps.log ?? ((line: string) => console.log(line));
  const buildTimeoutMs = deps.buildTimeoutMs ?? BUILD_TIMEOUT_MS;
  let latest: PendingBuild | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;
  let current: AbortController | null = null;
  let compaction: AbortController | null = null;

  async function compact(run: NonNullable<TodayBuild["compact"]>): Promise<void> {
    const controller = new AbortController();
    compaction = controller;
    if (latest || stopped) controller.abort();
    try {
      await run(controller.signal);
    } catch (error) {
      log(`today: compaction failed, ${String(error)}`);
    } finally {
      compaction = null;
    }
  }

  async function runOne({ day, attempt }: PendingBuild): Promise<void> {
    const claim = await deps.port.post("todayClaim", { day, attempt, claimId: crypto.randomUUID() });
    if (!claim) {
      log(`today: ${day} attempt ${attempt} belongs to another worker`);
      return;
    }
    const controller = new AbortController();
    current = controller;
    let result: TodayBuild;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<TodayBuild>((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new Error("The build timed out"));
        resolve({ outcome: { ok: false, error: "The build timed out" }, accept: () => undefined });
      }, buildTimeoutMs);
    });
    try {
      result = await Promise.race([deps.build({ day, attempt, ...claim }, controller.signal), deadline]);
    } catch (error) {
      result = { outcome: { ok: false, error: error instanceof Error ? error.message : String(error) }, accept: () => undefined };
    } finally {
      clearTimeout(timer);
      current = null;
    }
    const { outcome } = result;
    const accepted = await deps.port.post("todayFinish", { day, attempt, outcome });
    log(`today: ${day} attempt ${attempt} ${claim.mode} ${outcome.ok ? `built, ${outcome.queue.items.length} items` : `failed: ${outcome.error}`}`);
    if (!accepted || controller.signal.aborted) return;
    result.accept();
    if (result.compact) await compact(result.compact);
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
    if (pending) compaction?.abort();
    if (pending && !running && !stopped) running = drain();
  });

  return {
    stop() {
      stopped = true;
      current?.abort(new Error("The Today worker stopped"));
      compaction?.abort();
      unsubscribe();
    },
    idle: async () => { await running; },
  };
}
