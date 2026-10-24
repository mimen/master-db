import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { RetryWork } from "../bridge/retry";
import { userContent } from "./attachments";
import { newestMessageAt, PACKET_MESSAGES, systemAppend, withThreadDelta } from "./context";
import type { Chat, ChatId, CommandRow, ConversationId, Port } from "./convex-port";
import { resolveSelection, type Selection } from "./models";
import { turnEndItem } from "./normalize";
import { AgentSession, type QueryFactory } from "./session";

export const MAX_LIVE = 4;
export const IDLE_CLOSE_MS = 10 * 60_000;

export type SessionOptionsInput = { chatId: ChatId; chat: Chat; selection: Selection; sessionId: string; resume: boolean; append: string };

export type SessionsDeps = {
  port: Port;
  query: QueryFactory;
  now: () => number;
  timeZone: string;
  /** Reserves a ccs session for a new chat, in the chat's working directory, and returns its id. */
  reserve: (chatId: ChatId, title: string) => Promise<string>;
  readAddendum: () => string | null;
  options: (input: SessionOptionsInput) => Options;
  /** The chat's working directory; message attachments are saved under it. */
  scratch: (chatId: ChatId) => string;
  fetch: (url: string) => Promise<Response>;
  /** A title for a chat from its first ask, or null when none came back; a failure rejects with why. */
  title: (firstAsk: string) => Promise<string | null>;
  log?: (message: string) => void;
};

type Live = { session: AgentSession; conversationId: ConversationId; seenThrough?: number; persistedSeen?: number };

/** The runner's live sessions: at most four, idle ones closed after ten minutes, the longest idle evicted first. */
export class Sessions {
  private live = new Map<ChatId, Live>();
  private sessionIds = new Map<ChatId, string>();
  private chains = new Map<ChatId, Promise<void>>();
  private opening: Promise<unknown> = Promise.resolve();
  private latest: CommandRow[] = [];
  private requested = new Set<CommandRow["_id"]>();
  /** Chats with a title request in flight or landed; a failed one leaves so the next ask retries. */
  private titling = new Set<ChatId>();
  private work = new RetryWork("agent commands", () => this.claim());

  constructor(private deps: SessionsDeps) {}

  private log(message: string) { (this.deps.log ?? console.error)(`comma agent: ${message}`); }

  get liveChatIds(): ChatId[] { return [...this.live.keys()]; }

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

  private async handle({ _id, chatId, chat, command }: CommandRow) {
    const live = this.current(chatId);
    switch (command.kind) {
      case "message": {
        if (!chat.title) this.nameChat(chatId, command.text);
        try {
          const selection = resolveSelection(command.model ?? chat.model, command.effort ?? chat.effort);
          const target = await this.selected(chatId, chat, selection, live);
          const text = await this.withDelta(chatId, target, command.text);
          const dir = join(this.deps.scratch(chatId), "attachments", _id);
          await target.session.send(await userContent(text, command.attachments ?? [], { fetch: this.deps.fetch, dir }), command.steer);
        } catch (error) {
          await this.failChat(chatId, error);
        }
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

  /** Runs beside the turn, never ahead of it. */
  private nameChat(chatId: ChatId, ask: string) {
    if (this.titling.has(chatId)) return;
    this.titling.add(chatId);
    const failed = (reason: string) => {
      this.titling.delete(chatId);
      this.log(`title for ${chatId}: ${reason}`);
    };
    void this.deps.title(ask)
      .then(async (title) => title ? await this.deps.port.post("agentChat", { chatId, title }) : failed("none came back"))
      .catch((error) => failed(String(error)));
  }

  private current(chatId: ChatId): Live | undefined {
    const live = this.live.get(chatId);
    if (live && !live.session.live) this.live.delete(chatId);
    return live?.session.live ? live : undefined;
  }

  /**
   * The live session on the message's selection. Every model runs on one gateway environment, so
   * a switch is live; when the CLI rejects one, the session resumes in a new process on the new
   * selection. A busy session keeps its turn's selection and switches at the next idle message.
   */
  private async selected(chatId: ChatId, chat: Chat, selection: Selection, live: Live | undefined): Promise<Live> {
    if (!live) return await this.open(chatId, chat, selection);
    try {
      await live.session.select(selection);
      return live;
    } catch (error) {
      this.log(`live switch to ${selection.model} at ${selection.effort} failed for ${chatId}, resuming in a new process: ${String(error)}`);
      await this.closeChat(chatId);
      return await this.open(chatId, chat, selection);
    }
  }

  private open(chatId: ChatId, chat: Chat, selection: Selection): Promise<Live> {
    const opened = this.opening.then(() => this.start(chatId, chat, selection));
    this.opening = opened.catch(() => {});
    return opened;
  }

  /** A claimed message that never reached Claude ends its chat as failed, so the pane is not left pending. */
  private async failChat(chatId: ChatId, error: unknown) {
    this.log(`message for ${chatId}: ${String(error)}`);
    const message = error instanceof Error ? error.message : String(error);
    await this.deps.port.post("agentItems", { chatId, items: [turnEndItem(`dispatch-${crypto.randomUUID()}`, "failed", undefined, message)] });
    await this.deps.port.post("agentChat", { chatId, state: "failed" });
  }

  private async start(chatId: ChatId, chat: Chat, selection: Selection): Promise<Live> {
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
      selection,
      options: this.deps.options({ chatId, chat, selection, sessionId, resume: Boolean(existing), append }),
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

  private async withDelta(chatId: ChatId, live: Live, text: string): Promise<string> {
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

  /** The longest-idle idle session goes first; a busy one only when none is idle. */
  private async evict() {
    const [chatId] = [...this.live.entries()]
      .filter(([, live]) => live.session.live)
      .sort(([, a], [, b]) => Number(b.session.state.kind === "idle") - Number(a.session.state.kind === "idle") || a.session.lastActivity - b.session.lastActivity)[0] ?? [];
    if (!chatId) return;
    this.log(`evicting ${chatId} to stay within ${MAX_LIVE} live sessions`);
    await this.closeChat(chatId);
  }

  private async closeChat(chatId: ChatId) {
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

  /** Stops claiming, gives in-flight dispatches up to graceMs to land, then closes every session. */
  async closeAll(graceMs = 5_000) {
    this.work.stop();
    await Promise.race([this.flush(), new Promise((resolve) => setTimeout(resolve, graceMs).unref())]);
    await Promise.all([...this.live.keys()].map((chatId) => this.closeChat(chatId)));
  }
}
