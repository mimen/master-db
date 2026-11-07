import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { laneOf, type CommandResult, type CommaOutboxLane } from "../../../../convex/schema/comma/validators";
import { ChatCommands, UnknownSendError } from "../commands";
import type { Config } from "../config";
import type { Bodies, Results } from "./convex-ingest";
import type { MessageWriter } from "./live";
import { commandHandlers, dispatchCommand } from "./commands";
import { CommandLease, LeaseLostError, type LeaseTimers } from "./commands/lease";
import type { AiContext, HandlerMap, IMessageContext } from "./commands/types";
import { RetryWork } from "./retry";

export type OutboxRow = Results["claim"][number];
const pendingOutbox = makeFunctionReference<"query", { bridgeKey: string; lane: CommaOutboxLane }, OutboxRow[]>("comma/outbox:pendingOutbox");
const LEASE_MS = 60_000;

type LaneBase = Pick<IMessageContext, "row" | "signal" | "withLeaseRenewal">;
type Execute = (row: OutboxRow, base: LaneBase) => Promise<CommandResult>;

/**
 * One lane's executor. It claims only its lane's rows and runs them one at a time, so a slow command
 * holds back only its own lane: a transcription never delays a send.
 */
class LaneDrain {
  readonly work: RetryWork;
  claimed: OutboxRow[] = [];
  private completion: Bodies["complete"] | null = null;
  private stopped = false;
  private lease: CommandLease | null = null;

  constructor(readonly lane: CommaOutboxLane, private deps: {
    writer: MessageWriter;
    handlers: HandlerMap;
    execute: Execute;
    now: () => number;
    leaseTimers?: LeaseTimers;
    executed: () => void;
  }) {
    this.work = new RetryWork(`outbox:${lane}`, () => this.drain());
  }

  private async drain(): Promise<void> {
    const { ingest } = this.deps.writer.deps;
    const now = this.deps.now;
    if (!this.claimed.length) {
      this.claimed = await ingest.post("claim", { now: now(), leaseMs: LEASE_MS, limit: 1, lane: this.lane });
    }
    const hadRows = this.claimed.length > 0;
    while (this.claimed.length && !this.stopped) {
      const row = this.claimed[0];
      if (!this.completion) {
        if ((row.leaseUntil ?? 0) <= now()) {
          this.claimed.shift();
          continue;
        }
        try {
          if (!row.claimToken) throw new Error("Claim has no fencing token");
          if (laneOf(row.payload.kind) !== this.lane) throw new Error(`${row.payload.kind} does not run on the ${this.lane} lane`);
          const lease = new CommandLease(() => ingest.post("renew", {
            clientKey: row.clientKey, claimToken: row.claimToken!, now: now(), leaseMs: LEASE_MS,
          }), this.deps.leaseTimers);
          this.lease = lease;
          if (this.deps.handlers[row.payload.kind].longRunning) lease.start();
          const result = await this.deps.execute(row, { row, signal: lease.signal, withLeaseRenewal: (work) => lease.withRenewal(work) });
          await lease.check();
          this.completion = { clientKey: row.clientKey, claimToken: row.claimToken, status: "sent", result,
            ...("message" in result ? { resultGuid: result.message.guid } : {}) };
        } catch (error) {
          this.completion = { clientKey: row.clientKey, claimToken: row.claimToken ?? "",
            status: error instanceof UnknownSendError || error instanceof LeaseLostError ? "unknown" : "failed",
            error: error instanceof Error ? error.message : String(error) };
        }
        this.deps.executed();
      }
      // Keep the receipt and the batch until acknowledged; never repeat the side effect.
      await ingest.post("complete", this.completion);
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
  }
}

export class OutboxBridge {
  private client: ConvexClient | null = null;
  private unsubscribes: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lanes: LaneDrain[];
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
    const { writer, commands } = deps;
    const handlers: HandlerMap = { ...commandHandlers, ...deps.handlers };
    const lane = (name: CommaOutboxLane, execute: Execute) => new LaneDrain(name, {
      writer, handlers, execute, now: () => this.now(), leaseTimers: deps.leaseTimers, executed: () => { this.lastExecutedAt = this.now(); },
    });
    this.lanes = [
      lane("imessage", async (row, base) => {
        if (row.payload.kind !== "createChat" && !row.conversationId) throw new Error("Command requires a conversation");
        const chatGuid = row.conversationId ? await writer.resolveConversation(row.conversationId) : null;
        if (row.payload.kind === "send") writer.rememberOutboxSend(row.clientKey);
        base.signal.throwIfAborted();
        return dispatchCommand<IMessageContext>(handlers, { ...base, chatGuid, commands, writer }, row.payload);
      }),
      lane("ai", async (row, base) => {
        if (row.payload.kind !== "clearSuggestionLearning" && !row.conversationId) throw new Error("Command requires a conversation");
        base.signal.throwIfAborted();
        return dispatchCommand<AiContext>(handlers, { ...base, conversationId: row.conversationId ?? null, ingest: writer.deps.ingest }, row.payload);
      }),
    ];
    const { convexCloudUrl, commaBridgeSecret } = deps.config;
    if (!convexCloudUrl || !commaBridgeSecret || deps.backgroundServices === false) return;
    const client = deps.client ?? new ConvexClient(convexCloudUrl);
    this.client = client;
    for (const drain of this.lanes) {
      this.unsubscribes.push(client.onUpdate(pendingOutbox, { bridgeKey: commaBridgeSecret, lane: drain.lane }, (rows) => {
        if (rows.length) drain.work.request();
      }, (error) => console.error(`comma bridge outbox subscription (${drain.lane}): ${String(error)}`)));
    }
    // Expired claimed rows don't appear in pendingOutbox, including after a restart.
    this.timer = setInterval(() => this.request(), 30_000);
    this.timer.unref();
    this.request();
  }

  get inFlight(): number { return this.lanes.reduce((sum, drain) => sum + drain.claimed.length, 0); }
  get pending(): number { return this.lanes.reduce((sum, drain) => sum + drain.work.pending, 0) + this.inFlight; }
  async flush(): Promise<void> { await Promise.all(this.lanes.map((drain) => drain.work.flush())); }

  private now(): number { return (this.deps.now ?? Date.now)(); }
  private request(): void { for (const drain of this.lanes) drain.work.request(); }

  stop(): void {
    for (const drain of this.lanes) drain.stop();
    if (this.timer) clearInterval(this.timer);
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    if (this.client) void this.client.close().catch((error) => console.error(`comma bridge outbox close: ${String(error)}`));
  }
}
