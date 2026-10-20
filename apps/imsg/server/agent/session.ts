import type { CanUseTool, Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { continuesTurn, Normalizer, questionItem, turnEndItem } from "./normalize";
import type { AgentChatState, Item, AgentQuestion } from "./convex-port";

export type QueryFactory = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) =>
  AsyncIterable<SDKMessage> & Pick<Query, "interrupt" | "close">;

type Turn = { id: string; startedAt: number; steerPending: boolean };
type PendingQuestion = { questions: AgentQuestion[]; resolve: (result: PermissionResult) => void };
/** idle, running and waiting_input are live; ended is terminal and the process is gone. */
export type SessionState =
  | { kind: "idle" }
  | { kind: "running"; turn: Turn }
  | { kind: "waiting_input"; turn: Turn; requests: Map<string, PendingQuestion> }
  | { kind: "ended"; outcome: "interrupted" | "failed" | "closed" };

const CHAT_STATE: Record<SessionState["kind"], AgentChatState> = { idle: "idle", running: "running", waiting_input: "waiting_input", ended: "idle" };
const chatState = (state: SessionState): AgentChatState => state.kind === "ended" && state.outcome !== "closed" ? state.outcome : CHAT_STATE[state.kind];

const TURN_OUTPUT = new Set<SDKMessage["type"]>(["stream_event", "assistant", "user", "result"]);

const questionsSchema = z.array(z.object({
  question: z.string(),
  header: z.string().optional(),
  multiSelect: z.boolean().default(false),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
}));

/** Ported from T3 Code's claudeSdkUserInputAnswers: multi-select answers are comma-joined. */
export function sdkAnswers(answers: Record<string, string | string[]>): Record<string, string> {
  return Object.fromEntries(Object.entries(answers).map(([question, answer]) => [question, Array.isArray(answer) ? answer.join(", ") : answer]));
}

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(message: SDKUserMessage) {
    this.items.push(message);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      const next = this.items.shift();
      if (next) { yield next; continue; }
      if (this.closed) return;
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

export type SessionDeps = {
  sessionId: string;
  options: Options;
  query: QueryFactory;
  now: () => number;
  writeItems: (items: Item[]) => Promise<unknown>;
  writeState: (state: AgentChatState) => Promise<unknown>;
  onError: (error: unknown) => void;
};

/** One long-lived SDK query fed by an input queue, driving the chat's turn state machine. */
export class AgentSession {
  state: SessionState = { kind: "idle" };
  lastActivity: number;
  private input = new InputQueue();
  private normalizer = new Normalizer();
  private runtime: ReturnType<QueryFactory>;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private deps: SessionDeps) {
    this.lastActivity = deps.now();
    this.runtime = deps.query({ prompt: this.input, options: { ...deps.options, canUseTool: this.canUseTool } });
    void this.consume();
  }

  get live(): boolean { return this.state.kind !== "ended"; }

  /** Starts a turn, or joins the running one: a steer interrupts it, a plain message queues behind it. */
  async send(text: string, steer: boolean): Promise<void> {
    if (this.state.kind === "ended") throw new Error("Session has ended");
    this.lastActivity = this.deps.now();
    if (this.state.kind === "waiting_input") this.cancelQuestions("The user replied in the chat instead of answering.");
    const steering = steer && "turn" in this.state;
    if (this.state.kind === "idle") this.transition({ kind: "running", turn: this.newTurn() });
    else if (steering && "turn" in this.state) this.state.turn.steerPending = true;
    this.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.deps.sessionId,
      ...(steering ? { priority: "now" as const } : {}),
    });
    await this.writes;
  }

  async answer(requestId: string, answers: Record<string, string | string[]>): Promise<void> {
    this.lastActivity = this.deps.now();
    this.settleQuestion(requestId, sdkAnswers(answers));
    await this.writes;
  }

  /** Ported from T3 Code: interrupt the query, then close it so a late result cannot end the next turn. */
  async interrupt(): Promise<void> {
    if (!("turn" in this.state)) return;
    const { turn } = this.state;
    this.cancelQuestions("User cancelled tool execution.");
    this.transition({ kind: "ended", outcome: "interrupted" });
    await this.runtime.interrupt().catch(this.deps.onError);
    this.shutdown();
    const now = this.deps.now();
    this.emit([...this.normalizer.flush(now, "failed"), turnEndItem(`${turn.id}:interrupted`, "interrupted", now - turn.startedAt)]);
    await this.writes;
  }

  async close(): Promise<void> {
    if ("turn" in this.state) await this.interrupt();
    if (this.state.kind === "idle") {
      this.state = { kind: "ended", outcome: "closed" };
      this.shutdown();
    }
    await this.writes;
  }

  private newTurn(): Turn {
    return { id: crypto.randomUUID(), startedAt: this.deps.now(), steerPending: false };
  }

  private transition(next: SessionState) {
    const changed = chatState(next) !== chatState(this.state);
    this.state = next;
    if (changed) this.enqueue(() => this.deps.writeState(chatState(next)));
  }

  private emit(items: Item[]) {
    if (items.length) this.enqueue(() => this.deps.writeItems(items));
  }

  private enqueue(write: () => Promise<unknown>) {
    this.writes = this.writes.then(write).catch(this.deps.onError);
  }

  private shutdown() {
    this.input.close();
    this.runtime.close();
  }

  private canUseTool: CanUseTool = async (name, input, options) => {
    if (name !== "AskUserQuestion") return { behavior: "allow", updatedInput: input };
    if (this.state.kind === "ended" || options.signal.aborted) return { behavior: "deny", message: "The turn is no longer active." };
    const questions = questionsSchema.parse(input.questions);
    const turn = "turn" in this.state ? this.state.turn : this.newTurn();
    const requests = this.state.kind === "waiting_input" ? this.state.requests : new Map<string, PendingQuestion>();
    const answered = new Promise<PermissionResult>((resolve) => requests.set(options.toolUseID, { questions, resolve }));
    this.transition({ kind: "waiting_input", turn, requests });
    this.emit([questionItem(options.toolUseID, questions, "pending")]);
    const abort = () => this.settleQuestion(options.toolUseID, null);
    options.signal.addEventListener("abort", abort, { once: true });
    try {
      return await answered;
    } finally {
      options.signal.removeEventListener("abort", abort);
    }
  };

  private settleQuestion(requestId: string, answers: Record<string, string> | null, denial = "User cancelled tool execution.") {
    if (this.state.kind !== "waiting_input") return;
    const request = this.state.requests.get(requestId);
    if (!request) return;
    this.state.requests.delete(requestId);
    if (!this.state.requests.size) this.transition({ kind: "running", turn: this.state.turn });
    this.emit([questionItem(requestId, request.questions, answers ? "resolved" : "cancelled", answers ?? undefined)]);
    request.resolve(answers
      ? { behavior: "allow", updatedInput: { questions: request.questions, answers } }
      : { behavior: "deny", message: denial });
  }

  private cancelQuestions(denial: string) {
    if (this.state.kind !== "waiting_input") return;
    for (const requestId of [...this.state.requests.keys()]) this.settleQuestion(requestId, null, denial);
  }

  private async consume(): Promise<void> {
    try {
      for await (const message of this.runtime) {
        if (this.state.kind === "ended") return;
        const now = this.deps.now();
        this.lastActivity = now;
        // Output with no turn open means a queued send started one the runner did not see begin.
        if (this.state.kind === "idle" && TURN_OUTPUT.has(message.type)) this.transition({ kind: "running", turn: this.newTurn() });
        const turn = "turn" in this.state ? this.state.turn : null;
        this.emit(this.normalizer.consume(message, now, turn?.steerPending ?? false));
        if (message.type !== "result" || !turn) continue;
        const steered = turn.steerPending;
        turn.steerPending = false;
        if (continuesTurn(message, steered)) continue;
        if (message.is_error || message.subtype !== "success") {
          this.transition({ kind: "ended", outcome: "failed" });
          this.shutdown();
        } else {
          this.transition({ kind: "idle" });
        }
      }
      if (this.state.kind !== "ended") this.fail("The Claude process exited.");
    } catch (error) {
      if (this.state.kind === "ended") return;
      this.deps.onError(error);
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(error: string) {
    const turn = "turn" in this.state ? this.state.turn : null;
    this.cancelQuestions("The Claude process exited.");
    this.transition({ kind: "ended", outcome: turn ? "failed" : "closed" });
    this.shutdown();
    const now = this.deps.now();
    if (turn) this.emit([...this.normalizer.flush(now, "failed"), turnEndItem(`${turn.id}:failed`, "failed", now - turn.startedAt, error)]);
  }
}
