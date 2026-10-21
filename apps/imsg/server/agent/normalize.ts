import { basename } from "node:path";
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { makeAssistantStreamingFilter } from "./assistant-streaming";
import type { AgentEntry, Item, AgentQuestion } from "./convex-port";

type TextKind = "assistant" | "thinking";
type TextBlock = { key: string; kind: TextKind; text: string; done: boolean };
type ToolEntry = Extract<AgentEntry, { kind: "tool" }>;
type Todo = Extract<AgentEntry, { kind: "todos" }>["todos"][number];
type Fields = Record<string, unknown>;

const DETAIL_LIMIT = 4000;
// AskUserQuestion surfaces as a question item through canUseTool, and TodoWrite as the turn's
// todos item, not as tool steps.
const QUESTION_TOOL = "AskUserQuestion";
const TODO_TOOL = "TodoWrite";

const CREDENTIAL_READ = /\bop\s+(?:read|item\s+get)\b/;
const SKILL_FILE = /\/skills\/([^/]+)\/(?:SKILL\.md$|references\/)/;
const CONVEX_FUNCTION = /^[\w./-]+:[\w.]+$/;

/** A 1Password read: the step shows no command, input, or output, since any of them can carry the secret. */
export const isCredentialRead = (name: string, input: Fields) => name === "Bash" && CREDENTIAL_READ.test(String(input.command ?? ""));

/** `bunx convex run [flags] <module>:<fn> [args]` names its function; the label is the function's own name. */
function convexFunction(command: string): string | null {
  const [, rest] = command.split(/\bconvex\s+run\s/, 2);
  const spec = rest?.split(/\s+/).find((token) => CONVEX_FUNCTION.test(token));
  return spec?.split(":").pop()?.split(".").pop() ?? null;
}

function bashSummary(input: Fields): string {
  const command = String(input.command ?? "");
  if (CREDENTIAL_READ.test(command)) return "Read a credential";
  const convex = convexFunction(command);
  if (convex) return `Ran ${convex}`;
  return typeof input.description === "string" && input.description.trim() ? input.description : `Ran: ${command}`;
}

function readSummary(input: Fields): string {
  const path = String(input.file_path ?? "");
  const skill = SKILL_FILE.exec(path)?.[1];
  return skill ? `Loaded ${skill} skill` : `Read ${basename(path)}`;
}

/** Ported from T3 Code's claudeTodoSteps (ClaudeAdapterV2.ts at 05696c63, lines 3618-3646), keeping the SDK's own statuses. */
export function todoList(input: unknown): Todo[] {
  const todos = typeof input === "object" && input !== null ? (input as Fields).todos : undefined;
  if (!Array.isArray(todos)) return [];
  return todos.flatMap((todo: unknown): Todo[] => {
    if (typeof todo !== "object" || todo === null) return [];
    const { content, activeForm, status } = todo as Fields;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) return [];
    return [{
      content: text,
      ...(typeof activeForm === "string" && activeForm.trim() ? { activeForm: activeForm.trim() } : {}),
      status: status === "completed" || status === "in_progress" ? status : "pending",
    }];
  });
}

const COMMA_TOOL_SUMMARIES: Record<string, (input: Record<string, unknown>) => string> = {
  read_thread: () => "Read the thread",
  search_thread: (input) => `Searched: ${String(input.query ?? "")}`,
  get_people: () => "Looked up people",
  get_attachment: () => "Opened an attachment",
  set_draft: () => "Drafted a reply",
  attach_file: () => "Attached a file",
  send_message: () => "Sent a message",
};

const TOOL_SUMMARIES: Record<string, (input: Fields) => string> = {
  Read: readSummary,
  Edit: (input) => `Edited ${basename(String(input.file_path ?? ""))}`,
  MultiEdit: (input) => `Edited ${basename(String(input.file_path ?? ""))}`,
  Write: (input) => `Wrote ${basename(String(input.file_path ?? ""))}`,
  Bash: bashSummary,
  Grep: (input) => `Searched: ${String(input.pattern ?? "")}`,
  Glob: (input) => `Searched: ${String(input.pattern ?? "")}`,
  WebSearch: (input) => `Searched: ${String(input.query ?? "")}`,
  WebFetch: (input) => `Fetched ${String(input.url ?? "")}`,
  Skill: (input) => `Loaded ${String(input.skill ?? "")} skill`,
  Task: (input) => `Agent: ${String(input.description ?? "")}`,
  Agent: (input) => `Agent: ${String(input.description ?? "")}`,
};

export function toolSummary(name: string, input: unknown): string {
  const fields = typeof input === "object" && input !== null ? input as Fields : {};
  const comma = name.startsWith("mcp__comma__") ? COMMA_TOOL_SUMMARIES[name.slice("mcp__comma__".length)] : undefined;
  const summarize = comma ?? TOOL_SUMMARIES[name];
  const summary = summarize ? summarize(fields) : name.replace(/^mcp__/, "").replaceAll("__", " · ");
  return summary.replace(/\s+/g, " ").trim().slice(0, 160);
}

const clip = (text: string) => text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => block?.type === "text" ? String(block.text) : `[${String(block?.type)}]`).join("\n");
}

/**
 * A result ends the logical turn unless another queued send follows it. A steer
 * interrupts the running turn with an empty result and the steer's own turn follows.
 */
export function continuesTurn(result: SDKResultMessage, steerPending: boolean): boolean {
  if ((result.queued_turn_count ?? 0) > 0) return true;
  return steerPending && result.subtype === "success" && !result.result.trim();
}

export function questionItem(requestId: string, questions: AgentQuestion[], status: "pending" | "resolved" | "cancelled", answers?: Record<string, string>): Item {
  return { key: requestId, entry: { kind: "question", requestId, questions, status, ...(answers ? { answers } : {}) } };
}

export function turnEndItem(key: string, outcome: "completed" | "interrupted" | "failed", durationMs?: number, error?: string): Item {
  return { key, entry: { kind: "turn_end", outcome, ...(durationMs === undefined ? {} : { durationMs }), ...(error ? { error } : {}) } };
}

/** Maps the SDK message stream to comma_agent_items upserts, one per paragraph, thinking summary, or tool step. */
export class Normalizer {
  private filter = makeAssistantStreamingFilter("paragraph");
  private streamMessageId: string | null = null;
  private blocks = new Map<string, TextBlock[]>();
  private tools = new Map<string, ToolEntry>();
  /** The turn's todos item key, taken from its first TodoWrite call. */
  private todosKey: string | null = null;

  consume(message: SDKMessage, now: number, steerPending = false): Item[] {
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) return [];
    if (message.type === "stream_event") return this.streamEvent(message.event, now);
    if (message.type === "assistant") return this.assistant(message.message.id, message.uuid, message.message.content, now);
    if (message.type === "user") return this.toolResults(message.message.content, now);
    if (message.type === "result") {
      if (continuesTurn(message, steerPending)) return this.flush(now);
      const failed = message.is_error || message.subtype !== "success";
      const items = this.flush(now, failed ? "failed" : "done");
      const error = !failed ? undefined : message.subtype === "success" ? message.result : message.errors.join("\n");
      return [...items, turnEndItem(message.uuid, failed ? "failed" : "completed", message.duration_ms, error)];
    }
    return [];
  }

  /** Finalizes every block still streaming; at a turn's end, also settles the tool steps still running. */
  flush(now: number, tools?: "done" | "failed"): Item[] {
    const items: Item[] = [];
    for (const blocks of this.blocks.values()) {
      for (const block of blocks) if (!block.done) items.push(...this.finish(block, block.text, now));
    }
    this.blocks.clear();
    if (tools) {
      for (const [key, entry] of this.tools) items.push({ key, entry: { ...entry, status: tools, endedAt: now } });
      this.tools.clear();
      this.todosKey = null;
    }
    return items;
  }

  private streamEvent(event: Extract<SDKMessage, { type: "stream_event" }>["event"], now: number): Item[] {
    if (event.type === "message_start") {
      this.streamMessageId = event.message.id;
      return [];
    }
    const messageId = this.streamMessageId;
    if (!messageId) return [];
    if (event.type === "content_block_start") {
      const block = event.content_block;
      const kind: TextKind | null = block.type === "text" ? "assistant" : block.type === "thinking" ? "thinking" : null;
      if (!kind) return [];
      const blocks = this.blocks.get(messageId) ?? [];
      blocks[event.index] = { key: `${messageId}:${event.index}`, kind, text: "", done: false };
      this.blocks.set(messageId, blocks);
      return [];
    }
    if (event.type === "content_block_delta") {
      const block = this.blocks.get(messageId)?.[event.index];
      const delta = event.delta.type === "text_delta" ? event.delta.text : event.delta.type === "thinking_delta" ? event.delta.thinking : "";
      if (!block || block.done || !delta) return [];
      block.text += delta;
      return this.emit(block.key, block.kind, block.text, true, now);
    }
    return [];
  }

  // A streamed assistant message usually carries one content block per SDK frame, so
  // each final block claims the oldest unfinished streamed block of its kind.
  private assistant(messageId: string, frameId: string, content: Extract<SDKMessage, { type: "assistant" }>["message"]["content"], now: number): Item[] {
    const items: Item[] = [];
    content.forEach((block, index) => {
      if ((block.type === "text" && block.text) || (block.type === "thinking" && block.thinking)) {
        const kind: TextKind = block.type === "text" ? "assistant" : "thinking";
        const text = block.type === "text" ? block.text : block.thinking;
        const streamed = this.blocks.get(messageId)?.find((candidate) => candidate && candidate.kind === kind && !candidate.done);
        items.push(...this.finish(streamed ?? { key: `${frameId}:${index}`, kind, text, done: false }, text, now));
      } else if (block.type === "tool_use" && block.name === TODO_TOOL) {
        this.todosKey ??= `${block.id}:todos`;
        items.push({ key: this.todosKey, entry: { kind: "todos", todos: todoList(block.input) } });
      } else if (block.type === "tool_use" && block.name !== QUESTION_TOOL) {
        const fields = typeof block.input === "object" && block.input !== null ? block.input as Fields : {};
        const input = isCredentialRead(block.name, fields) ? {} : { input: clip(JSON.stringify(block.input)), detail: clip(JSON.stringify(block.input)) };
        const entry: ToolEntry = { kind: "tool", name: block.name, summary: toolSummary(block.name, block.input), ...input, status: "running", startedAt: now };
        this.tools.set(block.id, entry);
        items.push({ key: block.id, entry });
      }
    });
    return items;
  }

  private toolResults(content: Extract<SDKMessage, { type: "user" }>["message"]["content"], now: number): Item[] {
    if (!Array.isArray(content)) return [];
    const items: Item[] = [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const started = this.tools.get(block.tool_use_id);
      if (!started) continue;
      this.tools.delete(block.tool_use_id);
      const status = block.is_error ? "failed" : "done";
      // A credential read carries no input, and its output is the secret itself.
      if (started.input === undefined) {
        items.push({ key: block.tool_use_id, entry: { ...started, status, endedAt: now } });
        continue;
      }
      const output = resultText(block.content);
      items.push({ key: block.tool_use_id, entry: { ...started, status, endedAt: now, detail: clip([started.detail, output].filter(Boolean).join("\n\n")) } });
    }
    return items;
  }

  private finish(block: TextBlock, text: string, now: number): Item[] {
    block.done = true;
    return this.emit(block.key, block.kind, text, false, now);
  }

  private emit(key: string, kind: TextKind, text: string, streaming: boolean, now: number): Item[] {
    const event = this.filter({ type: "turn_item.updated", turnItem: { id: key, type: kind === "assistant" ? "assistant_message" : "reasoning", text, streaming } }, now);
    return event?.type === "turn_item.updated" ? [{ key, entry: { kind, text: event.turnItem.text, streaming } }] : [];
  }
}
