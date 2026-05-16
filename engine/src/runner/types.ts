import type { Proposal } from "./proposalSchema";

export interface TokenUsage {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export type CanonicalEvent =
  | { type: "user_message"; body_markdown: string }
  | {
      type: "assistant_message";
      body_markdown: string;
      token_usage?: TokenUsage;
    }
  | { type: "reasoning"; body_markdown: string }
  | {
      type: "tool_call_started";
      activity_key: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_call_resolved";
      activity_key: string;
      status: "ok" | "error";
      output: unknown;
    }
  | { type: "proposal"; proposal: Proposal; checkpoint_id: string }
  | { type: "execution_result"; body_markdown: string; checkpoint_id: string }
  | { type: "blocked"; body_markdown: string; checkpoint_id: string }
  | { type: "error"; error: { message: string; details?: unknown } };

export type CanonicalTerminalEvent = Extract<
  CanonicalEvent,
  { type: "proposal" | "execution_result" | "blocked" | "error" }
>;

export interface AgentRunInput {
  entity_ref: string;
  resume_cursor: unknown | null;
  entity_payload: unknown;
  message: string | null;
  on_event: (e: CanonicalEvent) => Promise<void>;
}

export interface AgentRunResult {
  resume_cursor: unknown;
  terminal: CanonicalTerminalEvent;
}

export interface AgentRunner {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  interrupt(entity_ref: string): Promise<void>;
}
