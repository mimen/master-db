import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ChatCommands, UnknownSendError } from "../commands";
import type { Config } from "../config";
import type { Bodies, Results } from "./convex-ingest";
import type { MessageWriter } from "./live";
import { commandHandlers, dispatchCommand } from "./commands";
import { CommandLease, LeaseLostError, type LeaseTimers } from "./commands/lease";
import type { HandlerMap } from "./commands/types";
import { RetryWork } from "./retry";

export type OutboxRow = Results["claim"][number];
const pendingOutbox = makeFunctionReference<"query", { bridgeKey: string }, OutboxRow[]>("comma/outbox:pendingOutbox");

export class OutboxBridge {
  private client: ConvexClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private work: RetryWork;
  private claimed: OutboxRow[] = [];
  private completion: Bodies["complete"] | null = null;
  private stopped = false;
  private lease: CommandLease | null = null;
  lastExecutedAt: number | null = null;

  constructor(private deps: {
    config: Pick<Config, "convexCloudUrl" | "commaBridgeSecret">;
    writer: MessageWriter;
    commands: ChatCommands;
    client?: ConvexClient;
    now?: () => number;
    backgroundServices?: boolean;
    handlers?: Partial<HandlerMap>;
    leaseTimers?: LeaseTimers;
  }) {
    this.work = new RetryWork("outbox", () => this.drain());
    const { convexCloudUrl, commaBridgeSecret } = deps.config;
    if (!convexCloudUrl || !commaBridgeSecret || deps.backgroundServices === false) return;
    this.client = deps.client ?? new ConvexClient(convexCloudUrl);
    this.unsubscribe = this.client.onUpdate(pendingOutbox, { bridgeKey: commaBridgeSecret }, (rows) => {
      if (rows.length) this.work.request();
    }, (error) => console.error(`comma bridge outbox subscription: ${String(error)}`));
    // Expired claimed rows don't appear in pendingOutbox, including after a restart.
    this.timer = setInterval(() => this.work.request(), 30_000);
    this.timer.unref();
    this.work.request();
  }

  get inFlight(): number { return this.claimed.length; }
  get pending(): number { return this.work.pending + this.inFlight; }
  flush(): Promise<void> { return this.work.flush(); }

  private now(): number { return (this.deps.now ?? Date.now)(); }

  private async drain(): Promise<void> {
    const { writer } = this.deps;
    if (!this.claimed.length) {
      this.claimed = await writer.deps.ingest.post("claim", { now: this.now(), leaseMs: 60_000, limit: 1 });
    }
    const hadRows = this.claimed.length > 0;
    while (this.claimed.length && !this.stopped) {
      const row = this.claimed[0];
      if (!this.completion) {
        if ((row.leaseUntil ?? 0) <= this.now()) {
          this.claimed.shift();
          continue;
        }
        try {
          if (!row.claimToken) throw new Error("Claim has no fencing token");
          const handlers: HandlerMap = { ...commandHandlers, ...this.deps.handlers };
          const global = row.payload.kind === "createChat" || row.payload.kind === "clearSuggestionLearning";
          if (!global && !row.conversationId) throw new Error("Command requires a conversation");
          const lease = new CommandLease(() => writer.deps.ingest.post("renew", {
            clientKey: row.clientKey, claimToken: row.claimToken!, now: this.now(), leaseMs: 60_000,
          }), this.deps.leaseTimers);
          this.lease = lease;
          if (handlers[row.payload.kind].longRunning) lease.start();
          const chatGuid = row.conversationId ? await writer.resolveConversation(row.conversationId) : null;
          if (chatGuid) await this.deps.commands.directory.ensureSiblings();
          if (row.payload.kind === "send") writer.rememberOutboxSend(row.clientKey);
          lease.signal.throwIfAborted();
          const result = await dispatchCommand(handlers, {
            chatGuid, row, commands: this.deps.commands, writer, signal: lease.signal,
            withLeaseRenewal: (work) => lease.withRenewal(work),
          }, row.payload);
          await lease.check();
          this.completion = { clientKey: row.clientKey, claimToken: row.claimToken, status: "sent", result,
            ...("message" in result ? { resultGuid: result.message.guid } : {}) };
        } catch (error) {
          this.completion = { clientKey: row.clientKey, claimToken: row.claimToken ?? "",
            status: error instanceof UnknownSendError || error instanceof LeaseLostError ? "unknown" : "failed",
            error: error instanceof Error ? error.message : String(error) };
        }
        this.lastExecutedAt = this.now();
      }
      // Keep the receipt and the batch until acknowledged; never repeat the BB side effect.
      await writer.deps.ingest.post("complete", this.completion);
      this.lease?.stop();
      this.lease = null;
      this.completion = null;
      this.claimed.shift();
    }
    if (hadRows && !this.stopped) this.work.request();
  }

  stop(): void {
    this.stopped = true;
    this.lease?.stop();
    this.work.stop();
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    if (this.client) void this.client.close().catch((error) => console.error(`comma bridge outbox close: ${String(error)}`));
  }
}
