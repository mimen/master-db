// Canonical source of truth for agent run-status display metadata.
// Both StatusPill and QueueFilterBar consume this so labels can't drift.
// Color/pulse values originate from the StatusPill pattern
// (adapted from pingdotgg/t3code, MIT - see THIRD_PARTY_NOTICES.md).

export type StatusMeta = { label: string; cls: string; pulse: boolean }

export const STATUS_META: Record<string, StatusMeta> = {
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground", pulse: false },
  discovering: { label: "Thinking", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30", pulse: true },
  awaiting_decision: { label: "Awaiting decision", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", pulse: false },
  executing: { label: "Running", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30", pulse: true },
  error: { label: "Error", cls: "bg-rose-500/15 text-rose-600 border-rose-500/30", pulse: false },
}

export function getStatusMeta(status: string): StatusMeta {
  return STATUS_META[status] ?? { label: status, cls: "bg-muted text-muted-foreground", pulse: false }
}

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([key, meta]) => [key, meta.label]),
)
