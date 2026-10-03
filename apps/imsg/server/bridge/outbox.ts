import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ChatCommands, UnknownSendError } from "../commands";
import type { Config } from "../config";
import type { Bodies, Results } from "./convex-ingest";
import type { MessageWriter } from "./live";
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
  lastExecutedAt: number | null = null;

  constructor(private deps: {
    config: Pick<Config, "convexCloudUrl" | "commaBridgeSecret">;
    writer: MessageWriter;
    commands: ChatCommands;
    client?: ConvexClient;
    now?: () => number;
    backgroundServices?: boolean;
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
      this.claimed = await writer.deps.ingest.post("claim", { now: this.now(), leaseMs: 60_000, limit: 10 });
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
          const chatGuid = await writer.resolveConversation(row.conversationId);
          await this.deps.commands.directory.ensureSiblings();
          if (row.payload.kind === "send") writer.rememberOutboxSend(row.clientKey);
          const result = await this.execute(chatGuid, row);
          this.completion = { clientKey: row.clientKey, status: "sent", ...result };
        } catch (error) {
          this.completion = { clientKey: row.clientKey,
            status: error instanceof UnknownSendError ? "unknown" : "failed", error: String(error) };
        }
        this.lastExecutedAt = this.now();
      }
      // Keep the receipt and the batch until acknowledged; never repeat the BB side effect.
      await writer.deps.ingest.post("complete", this.completion);
      this.completion = null;
      this.claimed.shift();
    }
    if (hadRows && !this.stopped) this.work.request();
  }

  private async execute(chatGuid: string, row: OutboxRow): Promise<{ resultGuid?: string }> {
    const { commands, writer } = this.deps;
    const { payload } = row;
    const directory = commands.directory;
    const accept = (result: { ok: boolean; error?: string }) => {
      if (!result.ok) throw new Error(result.error ?? "BlueBubbles operation failed");
    };
    switch (payload.kind) {
      case "send": {
        const result = await commands.send(chatGuid, payload, row.clientKey);
        if (!result.ok) throw new Error(result.error);
        return { resultGuid: result.value.guid };
      }
      case "react": accept(await commands.react(payload.messageGuid, { ...payload, chatGuid })); break;
      case "edit": accept(await commands.edit(payload.messageGuid, payload.text, payload.partIndex)); break;
      case "unsend": accept(await commands.unsend(payload.messageGuid, payload.partIndex)); break;
      case "delete": accept(await commands.delete(payload.messageGuid, chatGuid)); break;
      case "markRead": accept({ ok: await commands.markRead(chatGuid), error: "BlueBubbles mark read failed" }); break;
      case "markUnread": directory.markUnread(chatGuid); break;
      case "pin": directory.setPinned(chatGuid, payload.value); break;
      case "mute":
        writer.deps.db.setMutedUnresponded(chatGuid, payload.value);
        directory.invalidate();
        break;
      case "settle": {
        const summaries = await directory.summaries();
        if (!summaries.ok) throw new Error(summaries.error);
        const chat = summaries.chats.find((item) => item.guid === directory.canonicalGuid(chatGuid));
        accept(await directory.dismiss(chatGuid, chat?.lastMessage?.isFromMe ? "waiting" : "unresponded", payload.messageGuid));
        break;
      }
      case "unsettle":
        accept(await directory.undismiss(chatGuid, "unresponded"));
        accept(await directory.undismiss(chatGuid, "waiting"));
        break;
      case "rename": accept(await commands.rename(chatGuid, payload.name)); break;
      case "schedule": accept(await commands.schedule({ ...payload, chatGuid })); break;
      case "editScheduled": accept(await commands.schedule({ ...payload, chatGuid }, payload.bbId)); break;
      case "cancelScheduled": accept(await commands.cancelScheduled(payload.bbId)); break;
      default: {
        const exhaustive: never = payload;
        throw new Error(`Unsupported outbox command ${String(exhaustive)}`);
      }
    }
    return {};
  }

  stop(): void {
    this.stopped = true;
    this.work.stop();
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    if (this.client) void this.client.close().catch((error) => console.error(`comma bridge outbox close: ${String(error)}`));
  }
}
