import { randomUUID } from "node:crypto";

import {
  query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKResultError,
  type SDKResultSuccess,
  type SDKSystemMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  BetaContentBlock,
  BetaThinkingBlock,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";

import { ProposalSchema, type Proposal } from "./proposalSchema";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRunner,
  CanonicalEvent,
  CanonicalTerminalEvent,
} from "./types";

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface SessionContext {
  session_id: string | null;
  abort: AbortController;
  turn_count: number;
}

// ---------------------------------------------------------------------------
// Resume cursor — typed so we never touch `any`
// ---------------------------------------------------------------------------

interface ClaudeResumeCursor {
  session_id: string | null;
  turn_count: number;
}

function isClaudeResumeCursor(v: unknown): v is ClaudeResumeCursor {
  return (
    typeof v === "object" &&
    v !== null &&
    "session_id" in v &&
    "turn_count" in v
  );
}

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface ClaudeSdkRunnerOpts {
  systemPrompt?: string;
  /**
   * SDK PermissionMode. Valid values per SDK types:
   * 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'
   */
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk"
    | "auto";
  model?: string;
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Default system prompt
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM = `You are the agentic engine's discover-and-propose runtime. On each turn:
1. Read the entity payload provided in the prompt.
2. Use available skills/MCPs to gather context.
3. Decide what to do, then emit EXACTLY ONE final assistant message that is a JSON object matching the Proposal schema (kind, summary, options[], free_text_allowed, optionally findings, recommended_option_id, question).
   Wrap the JSON in <proposal>...</proposal> tags.
4. If a user message starts with EXECUTE: <option_id>, perform that option using write tools and reply with a Proposal whose kind="execution_result".
Never emit free prose after the </proposal> tag.`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createClaudeSdkRunner(
  opts: ClaudeSdkRunnerOpts = {},
): AgentRunner {
  const sessions = new Map<string, SessionContext>();

  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const prevCursor = isClaudeResumeCursor(input.resume_cursor)
        ? input.resume_cursor
        : null;

      const ctx: SessionContext = sessions.get(input.entity_ref) ?? {
        session_id: prevCursor?.session_id ?? null,
        abort: new AbortController(),
        turn_count: prevCursor?.turn_count ?? 0,
      };
      sessions.set(input.entity_ref, ctx);

      const userPrompt = buildUserPrompt(input);
      const iterable = query({
        prompt: userPrompt,
        options: {
          systemPrompt: opts.systemPrompt ?? DEFAULT_SYSTEM,
          permissionMode: opts.permissionMode ?? "auto",
          model: opts.model,
          cwd: opts.cwd,
          resume: ctx.session_id ?? undefined,
          abortController: ctx.abort,
        },
      });

      let terminal: CanonicalTerminalEvent | null = null;
      // Accumulate raw assistant text for the fallback proposal parser.
      let assistantBuffer = "";
      // Maps tool_use id → stable activity_key emitted on tool_call_started.
      const activityKeys = new Map<string, string>();

      for await (const msg of iterable) {
        const events = normalize(msg, activityKeys);

        for (const e of events) {
          if (isTerminal(e)) terminal = e;
          await input.on_event(e);
        }

        // Accumulate raw text for fallback parsing.
        if (isAssistantMessage(msg)) {
          for (const part of msg.message.content) {
            if (part.type === "text") assistantBuffer += part.text;
          }
        }

        // Capture the session_id from the init system message.
        if (isInitSystemMessage(msg)) {
          ctx.session_id = msg.session_id;
        }
      }

      // If no terminal event was emitted by normalize(), try parsing the
      // accumulated assistant text for a <proposal>…</proposal> block.
      if (!terminal) {
        const parsed = tryParseProposal(assistantBuffer);
        if (parsed) {
          terminal = {
            type: "proposal",
            proposal: parsed,
            checkpoint_id: randomUUID(),
          };
          await input.on_event(terminal);
        } else {
          terminal = {
            type: "error",
            error: {
              message:
                "no terminal event and no parseable proposal in transcript",
            },
          };
          await input.on_event(terminal);
        }
      }

      ctx.turn_count += 1;
      const nextCursor: ClaudeResumeCursor = {
        session_id: ctx.session_id,
        turn_count: ctx.turn_count,
      };
      return { resume_cursor: nextCursor, terminal };
    },

    async interrupt(entity_ref: string): Promise<void> {
      const ctx = sessions.get(entity_ref);
      if (ctx) {
        ctx.abort.abort();
        sessions.delete(entity_ref);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Type narrowing helpers
// ---------------------------------------------------------------------------

function isAssistantMessage(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === "assistant";
}

function isUserMessage(msg: SDKMessage): msg is SDKUserMessage {
  return msg.type === "user";
}

function isInitSystemMessage(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === "system" && msg.subtype === "init";
}

function isResultSuccess(msg: SDKMessage): msg is SDKResultSuccess {
  return msg.type === "result" && msg.subtype === "success";
}

function isResultError(msg: SDKMessage): msg is SDKResultError {
  return (
    msg.type === "result" &&
    (msg.subtype === "error_during_execution" ||
      msg.subtype === "error_max_turns" ||
      msg.subtype === "error_max_budget_usd" ||
      msg.subtype === "error_max_structured_output_retries")
  );
}

function isThinkingBlock(block: BetaContentBlock): block is BetaThinkingBlock {
  return block.type === "thinking";
}

function isToolUseBlock(block: BetaContentBlock): block is BetaToolUseBlock {
  return block.type === "tool_use";
}

function isToolResultParam(
  p: ContentBlockParam,
): p is Extract<ContentBlockParam, { type: "tool_result" }> {
  return p.type === "tool_result";
}

function isTerminal(e: CanonicalEvent): e is CanonicalTerminalEvent {
  return (
    e.type === "proposal" ||
    e.type === "execution_result" ||
    e.type === "blocked" ||
    e.type === "error"
  );
}

// ---------------------------------------------------------------------------
// Normalize a single SDK message → CanonicalEvent[]
// ---------------------------------------------------------------------------

function normalize(
  msg: SDKMessage,
  activityKeys: Map<string, string>,
): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  if (isAssistantMessage(msg)) {
    for (const part of msg.message.content) {
      if (part.type === "text") {
        events.push({ type: "assistant_message", body_markdown: part.text });
      } else if (isThinkingBlock(part)) {
        // BetaThinkingBlock uses `.thinking`, not `.text`
        events.push({ type: "reasoning", body_markdown: part.thinking });
      } else if (isToolUseBlock(part)) {
        const key = part.id;
        activityKeys.set(part.id, key);
        events.push({
          type: "tool_call_started",
          activity_key: key,
          name: part.name,
          input: part.input,
        });
      }
    }
    return events;
  }

  if (isUserMessage(msg)) {
    const content = msg.message.content;
    // content may be a plain string (no tool results) or an array.
    if (Array.isArray(content)) {
      for (const part of content) {
        if (isToolResultParam(part)) {
          const key = activityKeys.get(part.tool_use_id) ?? part.tool_use_id;
          events.push({
            type: "tool_call_resolved",
            activity_key: key,
            status: part.is_error ? "error" : "ok",
            output: part.content,
          });
        }
      }
    }
    return events;
  }

  if (isResultSuccess(msg)) {
    const parsed = tryParseProposal(msg.result);
    if (parsed) {
      const checkpoint_id = randomUUID();
      if (parsed.kind === "execution_result") {
        events.push({
          type: "execution_result",
          body_markdown: parsed.summary,
          checkpoint_id,
        });
      } else if (parsed.kind === "blocked") {
        events.push({
          type: "blocked",
          body_markdown: parsed.summary,
          checkpoint_id,
        });
      } else {
        events.push({ type: "proposal", proposal: parsed, checkpoint_id });
      }
    }
    return events;
  }

  if (isResultError(msg)) {
    events.push({
      type: "error",
      error: {
        message: `agent terminated with ${msg.subtype}`,
        details: msg.errors,
      },
    });
    return events;
  }

  return events;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function buildUserPrompt(input: AgentRunInput): string {
  return JSON.stringify({
    entity_ref: input.entity_ref,
    entity_payload: input.entity_payload,
    user_message: input.message,
  });
}

function tryParseProposal(text: string): Proposal | null {
  const open = text.indexOf("<proposal>");
  const close = text.lastIndexOf("</proposal>");
  if (open === -1 || close === -1 || close < open) return null;
  const json = text.slice(open + "<proposal>".length, close).trim();
  try {
    const obj: unknown = JSON.parse(json);
    return ProposalSchema.parse(obj);
  } catch {
    return null;
  }
}
