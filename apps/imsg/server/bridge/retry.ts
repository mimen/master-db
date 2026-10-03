export class RetryWork {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private dirty = false;
  private stopped = false;
  private failures = 0;

  constructor(private label: string, private work: () => Promise<void>) {}

  get pending(): number { return Number(this.dirty) + Number(this.running !== null); }

  request(delay = 0): void {
    if (this.stopped) return;
    this.dirty = true;
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped || !this.dirty) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = (async () => {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        try {
          await this.work();
          this.failures = 0;
        } catch (error) {
          console.error(`comma bridge ${this.label}: ${String(error)}`);
          this.dirty = true;
          this.failures++;
          break;
        }
      }
    })();
    await this.running;
    this.running = null;
    if (this.dirty) this.request(Math.min(60_000, 1000 * 2 ** Math.min(this.failures - 1, 6)));
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
