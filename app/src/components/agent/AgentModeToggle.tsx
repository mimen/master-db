import { Bot, List } from "lucide-react"

export type ViewMode = "standard" | "agent"

export interface AgentModeToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

function segmentClass(active: boolean): string {
  return `flex items-center gap-1 text-[11px] rounded px-2 py-0.5 transition-colors ${
    active
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground"
  }`
}

/**
 * Compact segmented control flipping a task view between Standard and Agent
 * mode. Pure/controlled: the active side is highlighted; clicking a side calls
 * `onChange` with that mode.
 */
export function AgentModeToggle({ mode, onChange }: AgentModeToggleProps) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border bg-muted/50 p-0.5">
      <button
        type="button"
        aria-pressed={mode === "standard"}
        onClick={() => onChange("standard")}
        className={segmentClass(mode === "standard")}
      >
        <List className="h-3 w-3" aria-hidden="true" />
        Standard
      </button>
      <button
        type="button"
        aria-pressed={mode === "agent"}
        onClick={() => onChange("agent")}
        className={segmentClass(mode === "agent")}
      >
        <Bot className="h-3 w-3" aria-hidden="true" />
        Agent
      </button>
    </div>
  )
}
