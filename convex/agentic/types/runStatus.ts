export const RUN_STATUSES = [
  "idle",
  "discovering",
  "awaiting_decision",
  "executing",
  "error",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const isRunStatus = (s: string): s is RunStatus =>
  (RUN_STATUSES as readonly string[]).includes(s);

export const THREAD_MESSAGE_KINDS = [
  "user_message",
  "assistant_message",
  "reasoning",
  "proposal",
  "execution_result",
  "error",
] as const;
export type ThreadMessageKind = (typeof THREAD_MESSAGE_KINDS)[number];
export const isThreadMessageKind = (s: string): s is ThreadMessageKind =>
  (THREAD_MESSAGE_KINDS as readonly string[]).includes(s);

export const ACTIVITY_KINDS = [
  "tool_call",
  "approval_request",
  "approval_response",
  "context_compaction",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const isActivityKind = (s: string): s is ActivityKind =>
  (ACTIVITY_KINDS as readonly string[]).includes(s);
