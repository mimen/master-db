import type { BlueBubbles } from "../bluebubbles";
import type { LeaseTimers } from "./commands/lease";
import type { BridgeState, ConvexIngest } from "./convex-ingest";
import { RetryWork } from "./retry";

export const BRIDGE_HEARTBEAT_MS = 60_000;
export type BridgeCapabilities = Omit<BridgeState, "key" | "lastSeenAt">;

export class BridgeStatePublisher {
  private work: RetryWork;
  private heartbeat: ReturnType<typeof setInterval>;
  private changes: ReturnType<typeof setInterval>;
  private unsubscribe: () => void;
  private published: string | null = null;

  constructor(private deps: {
    bb: BlueBubbles;
    ingest: Pick<ConvexIngest, "post">;
    capabilities: () => BridgeCapabilities;
    now?: () => number;
    timers?: LeaseTimers;
  }) {
    const timers: LeaseTimers = deps.timers ?? { setInterval, clearInterval };
    this.work = new RetryWork("bridge state", async () => {
      const capabilities = deps.capabilities();
      await deps.ingest.post("ephemeral", { state: {
        kind: "bridgeState", key: "mini", ...capabilities, lastSeenAt: (deps.now ?? Date.now)(),
      } });
      this.published = JSON.stringify(capabilities);
    });
    this.heartbeat = timers.setInterval(() => this.work.request(), BRIDGE_HEARTBEAT_MS);
    // BlueBubbles capabilities can change during its periodic REST reconnect.
    this.changes = timers.setInterval(() => this.check(), 1000);
    this.heartbeat.unref?.(); this.changes.unref?.();
    this.unsubscribe = deps.bb.onEvent((event) => {
      if (event.kind === "stream-connected") this.work.request();
    });
    this.work.request();
  }

  check(): void {
    if (JSON.stringify(this.deps.capabilities()) !== this.published) this.work.request();
  }
  get pending(): number { return this.work.pending; }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void {
    const timers: LeaseTimers = this.deps.timers ?? { setInterval, clearInterval };
    timers.clearInterval(this.heartbeat); timers.clearInterval(this.changes);
    this.unsubscribe(); this.work.stop();
  }
}
