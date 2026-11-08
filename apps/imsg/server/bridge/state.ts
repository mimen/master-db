import type { LeaseTimers } from "./commands/lease";
import type { ConvexIngest, ExecutorStatus } from "./convex-ingest";
import { RetryWork } from "./retry";

export const STATUS_HEARTBEAT_MS = 60_000;
/** What an executor says about itself; the publisher adds its key and the time. */
export type ExecutorReport = Omit<ExecutorStatus, "key" | "lastSeenAt">;

/**
 * Publishes one executor's status row (comma/bridgeState): at startup, every minute as a heartbeat, within a second
 * of its report changing, and whenever `reconnects` fires.
 */
export class StatusPublisher {
  private work: RetryWork;
  private heartbeat: ReturnType<typeof setInterval>;
  private changes: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private published: string | null = null;

  constructor(private deps: {
    key: string;
    ingest: Pick<ConvexIngest, "post">;
    report: () => ExecutorReport;
    reconnects?: (listener: () => void) => () => void;
    now?: () => number;
    timers?: LeaseTimers;
  }) {
    const timers: LeaseTimers = deps.timers ?? { setInterval, clearInterval };
    this.work = new RetryWork(`status ${deps.key}`, async () => {
      const report = deps.report();
      await deps.ingest.post("ephemeral", { state: { kind: "executorStatus", key: deps.key, ...report, lastSeenAt: (deps.now ?? Date.now)() } });
      this.published = JSON.stringify(report);
    });
    this.heartbeat = timers.setInterval(() => this.work.request(), STATUS_HEARTBEAT_MS);
    this.changes = timers.setInterval(() => this.check(), 1000);
    this.heartbeat.unref?.(); this.changes.unref?.();
    this.unsubscribe = deps.reconnects?.(() => this.work.request()) ?? (() => {});
    this.work.request();
  }

  check(): void {
    if (JSON.stringify(this.deps.report()) !== this.published) this.work.request();
  }
  get pending(): number { return this.work.pending; }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void {
    const timers: LeaseTimers = this.deps.timers ?? { setInterval, clearInterval };
    timers.clearInterval(this.heartbeat); timers.clearInterval(this.changes);
    this.unsubscribe(); this.work.stop();
  }
}
