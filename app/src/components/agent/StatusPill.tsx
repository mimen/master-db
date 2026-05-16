// Status-pill pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md

type Props = { status: string }

const MAP: Record<string, { label: string; cls: string; pulse: boolean }> = {
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground", pulse: false },
  discovering: { label: "Thinking", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30", pulse: true },
  awaiting_decision: { label: "Awaiting you", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", pulse: false },
  executing: { label: "Executing", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30", pulse: true },
  error: { label: "Error", cls: "bg-rose-500/15 text-rose-600 border-rose-500/30", pulse: false },
}

export function StatusPill({ status }: Props) {
  const conf = MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground", pulse: false }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${conf.cls} ${conf.pulse ? "animate-pulse" : ""}`}>
      {conf.label}
    </span>
  )
}
