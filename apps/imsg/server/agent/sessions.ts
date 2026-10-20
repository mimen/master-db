import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { RetryWork } from "../bridge/retry";
import { newestMessageAt, PACKET_MESSAGES, systemAppend, withThreadDelta } from "./context";
import type { Chat, CommandRow, Port } from "./convex-port";
import { turnEndItem } from "./normalize";
import { AgentSession, type QueryFactory } from "./session";

export const MAX_LIVE = 4;
export const IDLE_CLOSE_MS = 10 * 60_000;

export type SessionOptionsInput = { chatId: string; chat: Chat; sessionId: string; resume: boolean; append: string };

export type SessionsDeps = {
  port: Port;
  query: QueryFactory;
  now: () => number;
  timeZone: string;
  /** Reserves a ccs session for a new chat, in the chat's working directory, and returns its id. */
  reserve: (chatId: string, title: string) => Promise<string>;
  readAddendum: () => string | null;
  options: (input: SessionOptionsInput) => Options;
  log?: (message: string) => void;
};

type Live = { session: AgentSession; conversationId: string; seenThrough?: number; persistedSeen?: number };

/** The runner's live sessions: at most four, idle ones closed after ten minutes, the longest idle evicted first. */
export class Sessions {
  private live = new Map<string, Live>();
  private sessionIds = new Map<string, string>();
  private chains = new Map<string, Promise<void>>();
  private opening: Promise<unknown> = Promise.resolve();
  private latest: CommandRow[] = [];
  private requested = new Set<string>();
  private work = new RetryWork("agent commands", () => this.claim());

  constructor(private deps: SessionsDeps) {}

  private log(message: string) { (this.deps.log ?? console.error)(`comma agent: ${message}`); }

  get liveChatIds(): string[] { return [...this.live.keys()]; }

  /** Runs once at boot: chats a previous process left mid-turn become interrupted. */
  recover() {
    return this.deps.port.post("agentRecover", { now: this.deps.now() });
  }

  /** Feeds the pendingAgentCommands subscription in; claims and dispatches what is new. */
  receive(rows: CommandRow[]) {
    this.latest = rows;
    this.work.request();
  }

  /** Resolves once claimed commands are dispatched and every chat's queue has drained. */
  async flush() {
    await this.work.flush();
    while (this.chains.size) await Promise.all(this.chains.values());
  }

  private async claim() {
    const pending = new Set(this.latest.map((row) => row._id));
    for (const id of this.requested) if (!pending.has(id)) this.requested.delete(id);
    const ids = [...pending].filter((id) => !this.requested.has(id));
    if (!ids.length) return;
    for (const id of ids) this.requested.add(id);
    let claimed: CommandRow[];
    try {
      claimed = await this.deps.port.post("agentClaim", { ids });
    } catch (error) {
      for (const id of ids) this.requested.delete(id);
      throw error;
    }
    for (const row of claimed.sort((a, b) => a.createdAt - b.createdAt)) this.dispatch(row);
  }

  /** Commands for one chat run in order; different chats proceed independently. */
  dispatch(row: CommandRow): Promise<void> {
    const previous = this.chains.get(row.chatId) ?? Promise.resolve();
    const next = previous.then(() => this.handle(row)).catch((error) => this.log(`${row.command.kind} for ${row.chatId}: ${String(error)}`));
    this.chains.set(row.chatId, next);
    void next.then(() => { if (this.chains.get(row.chatId) === next) this.chains.delete(row.chatId); });
    return next;
  }

  private async handle({ chatId, chat, command }: CommandRow) {
    const live = this.current(chatId);
    switch (command.kind) {
      case "message": {
        if (chat.archivedAt) return;
        const target = live ?? await this.open(chatId, chat);
        if (!target) return;
        const text = await this.withDelta(chatId, target, command.text);
        await target.session.send(text, command.steer);
        return;
      }
      case "answer":
        await live?.session.answer(command.requestId, command.answers);
        return;
      case "stop":
        if (live) await live.session.interrupt();
        else if (["pending", "running", "waiting_input"].includes(chat.state)) await this.deps.port.post("agentChat", { chatId, state: "interrupted" });
        return;
      case "close":
        await this.closeChat(chatId);
        return;
    }
  }

  private current(chatId: string): Live | undefined {
    const live = this.live.get(chatId);
    if (live && !live.session.live) this.live.delete(chatId);
    return live?.session.live ? live : undefined;
  }

  private open(chatId: string, chat: Chat): Promise<Live | null> {
    const opened = this.opening.then(() => this.start(chatId, chat));
    this.opening = opened.catch(() => {});
    return opened.catch(async (error) => {
      this.log(`opening ${chatId}: ${String(error)}`);
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.port.post("agentItems", { chatId, items: [turnEndItem(`open-${crypto.randomUUID()}`, "failed", undefined, message)] });
      await this.deps.port.post("agentChat", { chatId, state: "failed" });
      return null;
    });
  }

  private async start(chatId: string, chat: Chat): Promise<Live> {
    const { port, now } = this.deps;
    const context = await port.post("agentContext", { conversationId: chat.conversationId, limit: PACKET_MESSAGES });
    const existing = chat.sessionId ?? this.sessionIds.get(chatId);
    const sessionId = existing ?? await this.deps.reserve(chatId, `Comma · ${context.title}`);
    this.sessionIds.set(chatId, sessionId);
    if (!existing) await port.post("agentChat", { chatId, sessionId });
    while (this.liveCount() >= MAX_LIVE) await this.evict();
    const append = systemAppend({ addendum: this.deps.readAddendum(), conversationId: chat.conversationId, context, now: now(), timeZone: this.deps.timeZone });
    const session = new AgentSession({
      sessionId,
      options: this.deps.options({ chatId, chat, sessionId, resume: Boolean(existing), append }),
      query: this.deps.query,
      now,
      writeItems: (items) => port.post("agentItems", { chatId, items }),
      writeState: (state) => port.post("agentChat", { chatId, state }),
      onError: (error) => this.log(`${chatId}: ${String(error)}`),
    });
    const live: Live = {
      session, conversationId: chat.conversationId,
      seenThrough: newestMessageAt(context.messages, chat.seenThroughMessageAt), persistedSeen: chat.seenThroughMessageAt,
    };
    this.live.set(chatId, live);
    return live;
  }

  private async withDelta(chatId: string, live: Live, text: string): Promise<string> {
    const { port } = this.deps;
    const delta = live.seenThrough === undefined ? [] : (await port.post("agentContext", {
      conversationId: live.conversationId, sinceMessageAt: live.seenThrough, limit: PACKET_MESSAGES,
    })).messages.filter((message) => message.at > live.seenThrough!);
    live.seenThrough = newestMessageAt(delta, live.seenThrough);
    if (live.seenThrough !== undefined && live.seenThrough !== live.persistedSeen) {
      await port.post("agentChat", { chatId, seenThroughMessageAt: live.seenThrough });
      live.persistedSeen = live.seenThrough;
    }
    return withThreadDelta(text, delta, this.deps.timeZone);
  }

  private liveCount(): number {
    return [...this.live.keys()].filter((chatId) => this.current(chatId)).length;
  }

  private async evict() {
    const [chatId] = [...this.live.entries()]
      .filter(([, live]) => live.session.live)
      .sort(([, a], [, b]) => a.session.lastActivity - b.session.lastActivity)[0] ?? [];
    if (!chatId) return;
    this.log(`evicting ${chatId}, the longest idle of ${MAX_LIVE} live sessions`);
    await this.closeChat(chatId);
  }

  private async closeChat(chatId: string) {
    const live = this.live.get(chatId);
    this.live.delete(chatId);
    await live?.session.close();
  }

  /** Closes sessions idle for ten minutes; the next message resumes them by session id. */
  async sweep() {
    const cutoff = this.deps.now() - IDLE_CLOSE_MS;
    for (const [chatId, live] of [...this.live]) {
      if (!live.session.live) this.live.delete(chatId);
      else if (live.session.state.kind === "idle" && live.session.lastActivity <= cutoff) await this.closeChat(chatId);
    }
  }

  async closeAll() {
    this.work.stop();
    await Promise.all([...this.live.keys()].map((chatId) => this.closeChat(chatId)));
  }
}
