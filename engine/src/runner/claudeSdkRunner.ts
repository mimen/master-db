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
  /**
   * Extra dirs the agent's filesystem tools can reach beyond `cwd`.
   * Defaults to the vault + GitHub roots.
   */
  additionalDirectories?: string[];
  /**
   * Claude Code setting sources to load. `'user'` pulls everything from
   * `~/.claude/` including symlinked skills. Default: `['user']`.
   */
  settingSources?: Array<"user" | "project" | "local">;
}

const HOME = process.env.HOME ?? "";
const DEFAULT_CWD = `${HOME}/Documents`;
const DEFAULT_ADDITIONAL_DIRS = [
  `${HOME}/Documents/milad-vault`,
  `${HOME}/Documents/GitHub`,
];
const DEFAULT_SETTING_SOURCES: Array<"user" | "project" | "local"> = ["user"];

// ---------------------------------------------------------------------------
// Default system prompt
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM = `You are the agentic engine's discover-and-propose runtime. On each turn:

1. Read the entity payload provided in the prompt.
2. **Actively use your skills and tools to ground every claim in real data.** Reasoning-from-training is not acceptable for discovery. Concretely:
   - If the entity touches AUF data (artists, bookings, budget, humans, events) — call \`airtable\` to read actual rows. Don't guess at schema or counts.
   - If the entity references a vault concept (a project, a workspace, a person) — call \`obsidian-search\` to find what you already know.
   - If the entity references repos under \`~/Documents/GitHub/\` — read the relevant files with the standard Read tool.
   - If unsure what tools to call, list them via the Skill tool and pick the most relevant 2–3.
   - **Minimum bar: make at least 2 substantive tool calls before emitting a non-trivial proposal.** Exception: tasks that are genuinely self-contained (one-line reminders, etc.) — say so explicitly in \`findings\` if you skip tool use.
3. Emit EXACTLY ONE final assistant message: a JSON object wrapped in <proposal>...</proposal> tags. No free prose before or after the tags.
4. If the user message starts with "EXECUTE: <option_id>", perform that option using write tools and reply with a Proposal whose kind="execution_result".

NEVER pretend you used a tool when you didn't. NEVER cite a skill by name as evidence ("airtable's Humans table has X") unless you actually queried it. If you didn't check, say so plainly: "haven't inspected Airtable yet; recommending audit_before_deciding."

**Entity-attribute heuristics.** The right proposal shape depends on the entity's state, not just its content. Apply these biases before deciding what to propose:

- **Todoist task in Inbox** (no project, or project_name === "Inbox"): organization is the primary product. Lead with options that route the task to the right project, add labels, set priority, or split into subtasks. Acting on the task is a *secondary* option, not the recommended one. The user uses Inbox as a triage staging area, not a workspace.
- **Todoist task that's stale** (>3 months old with no recent updates): *before* proposing action, check if it has already been done by other means — grep the relevant repo(s), search Airtable for evidence of the feature shipping, search the vault for related notes. Stale-but-built is a real pattern; close-as-already-done is often the right call.
- **Todoist task in the wrong project** (content clearly belongs elsewhere — e.g. an AUF event task sitting in a personal project): propose rerouting. Don't propose execution before the task is in the right place.
- **Todoist task that's actually an epic** (description spans multiple deliverables / multiple weeks of work): propose splitting into subtasks or converting to a project plan, not direct execution.
- **Todoist task with a near due date** (<3 days): action over organization. Skip the routing options unless something is clearly mislabeled in a way that blocks action.
- **Email in inbox** (future entity type): same pattern — organization first, action second. Label/archive/route before responding.

These are biases, not rules. If a task is in inbox AND due tomorrow AND already half-done in a repo, the right answer can still be "execute it" — but the proposal should *acknowledge* the heuristic and say why you're overriding it.

The JSON inside <proposal> MUST conform to this schema EXACTLY. Field names and enum values are checked by zod and a wrong value causes the turn to be discarded:

{
  "kind": "clarification" | "proposal" | "execution_result" | "blocked",   // REQUIRED — one of these four strings, nothing else
  "summary": string,                                                       // REQUIRED — markdown, any length
  "findings": string[] | omit,                                             // optional, bullet list of context you gathered
  "options": [                                                             // REQUIRED — array, may be empty
    {
      "id": string,                  // REQUIRED — short stable id, used in EXECUTE: messages
      "label": string,               // REQUIRED — short button label
      "description": string,         // REQUIRED — 1-2 sentences describing the option
      "rationale": string | omit,    // optional
      "confidence": number,          // REQUIRED — float in [0, 1]
      "reversibility": "trivial" | "moderate" | "destructive",   // REQUIRED — one of these three
      "side_effects": string[] | omit                            // optional, e.g. ["sends email", "writes Todoist"]
    }
  ],
  "recommended_option_id": string | omit,   // optional — id of the recommended option
  "free_text_allowed": boolean,             // REQUIRED — true if user may reply freeform
  "question": string | omit                 // include when kind="clarification"
}

Kind semantics:
- "clarification": you need more information before proposing actions; populate "question" and use "options" as suggested answers.
- "proposal": you have concrete option(s) to act on.
- "execution_result": you performed an EXECUTE: action; summary describes what happened.
- "blocked": you cannot proceed (missing skill, ambiguous entity, etc.); summary explains why.

DO NOT invent new kind values like "triage" or "review". DO NOT use "recommended": true inside an option — use the top-level "recommended_option_id" string instead. EVERY option MUST have both "confidence" and "reversibility".`;

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
          permissionMode: opts.permissionMode ?? "bypassPermissions",
          model: opts.model,
          cwd: opts.cwd ?? DEFAULT_CWD,
          additionalDirectories:
            opts.additionalDirectories ?? DEFAULT_ADDITIONAL_DIRS,
          settingSources: opts.settingSources ?? DEFAULT_SETTING_SOURCES,
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
