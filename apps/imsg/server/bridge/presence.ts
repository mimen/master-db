import type { BBEvent, BlueBubbles } from "../bluebubbles";
import type { MessageRow } from "./convex-ingest";
import type { MessageWriter } from "./live";
import { RetryWork } from "./retry";

export const PEER_TYPING_TTL = 12_000;
export interface PresenceTimers {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

type PeerState = { peerTyping: boolean; updatedAt: number; expiresAt: number; sequence: number };

export class PresenceBridge {
  private states = new Map<string, PeerState>();
  private pendingChats = new Set<string>();
  private sequence = 0;
  private work: RetryWork;

  constructor(private writer: MessageWriter, private now = Date.now) {
    this.work = new RetryWork("presence", () => writer.exclusive(async () => {
      const chats = [...this.pendingChats];
      const canonical = new Map<MessageRow["conversationId"], PeerState>();
      for (const chatGuid of chats) {
        await writer.ensureChat(chatGuid);
        const id = writer.conversationIds.get(chatGuid);
        if (!id) throw new Error(`Unresolved typing conversation ${chatGuid}`);
        const state = this.states.get(chatGuid)!;
        if ((canonical.get(id)?.sequence ?? -1) < state.sequence) canonical.set(id, state);
      }
      for (const [conversationId, state] of canonical) {
        await writer.deps.ingest.post("ephemeral", { state: {
          kind: "presence", conversationId,
          peerTyping: state.peerTyping && state.expiresAt > this.now(), updatedAt: state.updatedAt, expiresAt: state.expiresAt,
        } });
      }
      for (const chatGuid of chats) {
        const id = writer.conversationIds.get(chatGuid)!;
        if (this.states.get(chatGuid)!.sequence <= canonical.get(id)!.sequence) this.pendingChats.delete(chatGuid);
      }
    }));
  }

  observe(event: BBEvent): void {
    if (event.kind === "typing") this.set(event.chatGuid, event.display);
    else if (event.kind === "new-message" && !event.message.isFromMe) {
      for (const chat of event.message.chats ?? []) {
        const id = this.writer.conversationIds.get(chat.guid);
        if (this.states.has(chat.guid) || [...this.states.keys()].some((guid) => id && this.writer.conversationIds.get(guid) === id)) {
          this.set(chat.guid, false);
        }
      }
    } else if (event.kind === "stream-connected") {
      for (const chatGuid of this.states.keys()) this.set(chatGuid, false);
    }
  }

  private set(chatGuid: string, peerTyping: boolean): void {
    const now = this.now();
    this.states.set(chatGuid, { peerTyping, updatedAt: now, expiresAt: now + (peerTyping ? PEER_TYPING_TTL : 0), sequence: ++this.sequence });
    this.pendingChats.add(chatGuid);
    this.work.request(50);
  }
  get pending(): number { return this.work.pending; }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void { this.work.stop(); }
}

export class OutboundTyping {
  private active = new Map<string, ReturnType<typeof setTimeout>>();
  private clearing = new Set<string>();
  private serial = new Map<string, Promise<void>>();
  private work: RetryWork;
  private unsubscribe: () => void;
  private stopped = false;

  constructor(private bb: BlueBubbles, private now = Date.now, private timers: PresenceTimers = { setTimeout, clearTimeout }) {
    this.work = new RetryWork("typing clear", async () => {
      for (const chatGuid of [...this.clearing]) {
        await this.exclusive(chatGuid, async () => {
          if (!this.clearing.has(chatGuid)) return;
          const result = await bb.setTyping(chatGuid, false);
          if (!result.ok) throw new Error(result.error);
          this.clearing.delete(chatGuid);
        });
      }
    });
    this.unsubscribe = bb.onEvent((event) => {
      if (event.kind !== "stream-connected") return;
      for (const chatGuid of this.active.keys()) this.expire(chatGuid);
      this.work.request();
    });
  }

  private exclusive(chatGuid: string, work: () => Promise<void>): Promise<void> {
    const previous = this.serial.get(chatGuid) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.serial.set(chatGuid, next);
    void next.finally(() => { if (this.serial.get(chatGuid) === next) this.serial.delete(chatGuid); }).catch(() => {});
    return next;
  }

  private expire(chatGuid: string): void {
    const timer = this.active.get(chatGuid);
    if (timer) this.timers.clearTimeout(timer);
    this.active.delete(chatGuid);
    this.clearing.add(chatGuid);
    this.work.request();
  }

  async set(chatGuid: string, active: boolean, expiresAt: number): Promise<void> {
    await this.exclusive(chatGuid, async () => {
      if (this.stopped || (active && expiresAt <= this.now())) return;
      const previous = this.active.get(chatGuid);
      if (previous) this.timers.clearTimeout(previous);
      this.active.delete(chatGuid);
      this.clearing.delete(chatGuid);
      if (!active) this.clearing.add(chatGuid);
      if (active) {
        const timer = this.timers.setTimeout(() => this.expire(chatGuid), Math.max(0, expiresAt - this.now()));
        timer.unref?.();
        this.active.set(chatGuid, timer);
      }
      try {
        const result = await this.bb.setTyping(chatGuid, active);
        if (!result.ok) throw new Error(result.error);
      } catch (error) {
        if (active) this.expire(chatGuid);
        else this.work.request();
        throw error;
      }
      if (!active) this.clearing.delete(chatGuid);
      if (active && (expiresAt <= this.now() || !this.active.has(chatGuid))) this.expire(chatGuid);
    });
  }

  flush(): Promise<void> { return this.work.flush(); }
  stop(): void {
    this.stopped = true;
    this.unsubscribe();
    for (const chatGuid of this.active.keys()) this.expire(chatGuid);
    void this.work.flush().finally(() => this.work.stop());
  }
}
