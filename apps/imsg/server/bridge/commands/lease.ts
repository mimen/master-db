export class LeaseLostError extends Error {}
export interface LeaseTimers {
  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
}

/** A single non-overlapping heartbeat, kept alive until the receipt is acknowledged. */
export class CommandLease {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<void> | null = null;
  private stopped = false;
  private controller = new AbortController();
  get signal(): AbortSignal { return this.controller.signal; }

  constructor(private renew: () => Promise<boolean>, private timers: LeaseTimers = { setInterval, clearInterval }) {}

  start(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = this.timers.setInterval(() => { void this.tick(); }, 20_000);
    this.timer.unref?.();
  }
  private async tick(): Promise<void> {
    if (this.pending || this.stopped || this.signal.aborted) return;
    this.pending = (async () => {
      try {
        if (!await this.renew()) throw new LeaseLostError("Command lease was lost");
      } catch (error) {
        this.controller.abort(error instanceof LeaseLostError ? error : new LeaseLostError(`Command lease renewal failed: ${String(error)}`));
      }
    })();
    await this.pending;
    this.pending = null;
  }
  async withRenewal<T>(work: () => Promise<T>): Promise<T> {
    this.start();
    await this.check();
    const result = await work();
    await this.check();
    return result;
  }
  async check(): Promise<void> {
    await this.pending;
    if (this.signal.aborted) throw this.signal.reason;
  }
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.controller.abort(new LeaseLostError("Command executor stopped"));
  }
}
