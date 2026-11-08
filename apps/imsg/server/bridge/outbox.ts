import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { CommandResult, CommaOutboxLane } from "../../../../convex/schema/comma/validators";
import { ChatCommands, UnknownSendError } from "../commands";
import type { Config } from "../config";
import type { Bodies, ConvexIngest, Results } from "./convex-ingest";
import type { MessageWriter } from "./live";
import { dispatchCommand } from "./commands";
import { CommandLease, LeaseLostError, type LeaseTimers } from "./commands/lease";
import type { AiContext, AiHandlers, CommandKind, HandlerMap, IMessageContext, IMessageHandlers } from "./commands/types";
import { RetryWork } from "./retry";

export type OutboxRow = Results["claim"][number];
const pendingOutbox = makeFunctionReference<"query", { bridgeKey: string; lane: CommaOutboxLane }, OutboxRow[]>("comma/outbox:pendingOutbox");
const LEASE_MS = 60_000;

type LaneBase = Pick<IMessageContext, "row" | "signal" | "withLeaseRenewal">;
/** One lane this process executes: which commands renew their lease while they run, and how a row runs. */
export interface LaneExecutor {
  lane: CommaOutboxLane;
  longRunning(kind: CommandKind): boolean;
  execute(row: OutboxRow, base: LaneBase): Promise<CommandResult>;
}

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

  constructor(private executor: LaneExecutor, private deps: {
    ingest: Pick<ConvexIngest, "post">;
    now: () => number;
    leaseTimers?: LeaseTimers;
    executed: () => void;
  }) {
    this.work = new RetryWork(`outbox:${executor.lane}`, () => this.drain());
  }

  get lane(): CommaOutboxLane { return this.executor.lane; }

  private async drain(): Promise<void> {
    const { ingest } = this.deps;
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
          const lease = new CommandLease(() => ingest.post("renew", {
            clientKey: row.clientKey, claimToken: row.claimToken!, now: now(), leaseMs: LEASE_MS,
          }), this.deps.leaseTimers);
          this.lease = lease;
          if (this.executor.longRunning(row.payload.kind)) lease.start();
          const result = await this.executor.execute(row, { row, signal: lease.signal, withLeaseRenewal: (work) => lease.withRenewal(work) });
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

/** The iMessage lane: every command runs through the route Convex stamped on it, against BlueBubbles. */
export function imessageLane(deps: { writer: MessageWriter; commands: ChatCommands; handlers: IMessageHandlers }): LaneExecutor {
  const { writer, commands, handlers } = deps;
  return {
    lane: "imessage",
    longRunning: (kind) => (handlers as Partial<HandlerMap>)[kind]?.longRunning ?? false,
    execute: async (row, base) => {
      if (row.payload.kind !== "createChat" && !row.conversationId) throw new Error("Command requires a conversation");
      if (row.conversationId && !row.route) throw new Error("Command has no route");
      const chatGuid = row.route?.chatGuid ?? null;
      if (row.payload.kind === "send") writer.rememberOutboxSend(row.clientKey);
      base.signal.throwIfAborted();
      return dispatchCommand<IMessageContext>(handlers as HandlerMap, { ...base, chatGuid, commands, writer }, row.payload);
    },
  };
}

/** A model-work lane (ai, or aiBackground for precompute): reads and writes Convex by conversation id, never a platform. */
export function aiLane(deps: { ingest: Pick<ConvexIngest, "post">; handlers: AiHandlers; lane?: Extract<CommaOutboxLane, "ai" | "aiBackground"> }): LaneExecutor {
  const { ingest, handlers } = deps;
  return {
    lane: deps.lane ?? "ai",
    longRunning: (kind) => (handlers as Partial<HandlerMap>)[kind]?.longRunning ?? false,
    execute: async (row, base) => {
      if (row.payload.kind !== "clearSuggestionLearning" && !row.conversationId) throw new Error("Command requires a conversation");
      base.signal.throwIfAborted();
      return dispatchCommand<AiContext>(handlers as HandlerMap, { ...base, conversationId: row.conversationId ?? null, ingest }, row.payload);
    },
  };
}

/** Drains each lane this process executes, woken by its subscription to the lane's pending rows. */
export class OutboxBridge {
  private client: ConvexClient | null = null;
  private unsubscribes: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lanes: LaneDrain[];
  lastExecutedAt: number | null = null;

  constructor(private deps: {
    config: Pick<Config, "convexCloudUrl" | "commaBridgeSecret">;
    ingest: Pick<ConvexIngest, "post">;
    lanes: LaneExecutor[];
    client?: ConvexClient;
    now?: () => number;
    backgroundServices?: boolean;
    leaseTimers?: LeaseTimers;
  }) {
    this.lanes = deps.lanes.map((executor) => new LaneDrain(executor, {
      ingest: deps.ingest, now: () => this.now(), leaseTimers: deps.leaseTimers, executed: () => { this.lastExecutedAt = this.now(); },
    }));
    const { convexCloudUrl, commaBridgeSecret } = deps.config;
    if (!convexCloudUrl || !commaBridgeSecret || deps.backgroundServices === false) return;
    const client = deps.client ?? new ConvexClient(convexCloudUrl);
    this.client = client;
    for (const drain of this.lanes) {
      this.unsubscribes.push(client.onUpdate(pendingOutbox, { bridgeKey: commaBridgeSecret, lane: drain.lane }, (rows) => {
        if (rows.length) drain.work.request();
      }, (error) => console.error(`comma outbox subscription (${drain.lane}): ${String(error)}`)));
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
    if (this.client) void this.client.close().catch((error) => console.error(`comma outbox close: ${String(error)}`));
  }
}
