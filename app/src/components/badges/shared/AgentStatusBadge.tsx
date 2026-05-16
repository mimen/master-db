import { useAction, useQuery } from "convex/react"
import { Bot } from "lucide-react"
import { ulid } from "ulid"

import { api } from "@/convex/_generated/api"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"

/**
 * Agent Status Badge
 *
 * Persistent badge on a task row that reflects the entity's agentic-engine
 * run state. Visible only when an `agenticRuns` row exists for the entity
 * (i.e., once discovery has been triggered at least once). Returns null
 * otherwise — "completely unstarted" entities show no agent badge.
 *
 * Matches the visual idiom of the other shared badges (PriorityBadge,
 * LabelBadge, DateBadge): inline-flex rounded-full pill with a 3x3 icon.
 *
 * Click behavior depends on status:
 *  - idle: fire a fresh discovery run (POST /run with null message) and
 *    do NOT open the drawer. Badge transitions to "Thinking" reactively
 *    as the run progresses.
 *  - anything else (discovering / awaiting_decision / executing / error):
 *    open the drawer to view / interact.
 */

const STATUS_VARIANT: Record<
  string,
  { cls: string; label: string; pulse: boolean }
> = {
  idle: {
    cls: "border-border text-muted-foreground",
    label: "Agent",
    pulse: false,
  },
  discovering: {
    cls: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    label: "Thinking",
    pulse: true,
  },
  awaiting_decision: {
    cls: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    label: "Decide",
    pulse: false,
  },
  executing: {
    cls: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    label: "Running",
    pulse: true,
  },
  error: {
    cls: "bg-rose-500/10 text-rose-600 border-rose-500/30",
    label: "Error",
    pulse: false,
  },
}

export interface AgentStatusBadgeProps {
  entity_ref: string
}

export function AgentStatusBadge({ entity_ref }: AgentStatusBadgeProps) {
  const run = useQuery(api.agentic.queries.getRun.default, { entity_ref })
  const postRunAction = useAction(api.agentic.actions.postRun.default)
  const { open } = useAgentDrawer()

  // Loading or no run row → hidden entirely (the "completely unstarted" case).
  if (run === undefined || run === null) return null

  const status = (run as { status: string }).status
  const variant = STATUS_VARIANT[status] ?? STATUS_VARIANT.idle

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (status === "idle") {
      // Kick off a fresh discovery; do NOT open the drawer. Convex reactivity
      // will flip the badge to "Thinking" within ~a few hundred ms.
      void postRunAction({
        entity_ref,
        message: null,
        idempotency_key: ulid(),
        multitask_strategy: "enqueue",
      }).catch((err) => console.warn("[agent-badge] start failed", err))
      return
    }
    open(entity_ref)
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-normal gap-1.5 cursor-pointer hover:bg-accent/80 transition-colors ${variant.cls} ${variant.pulse ? "animate-pulse" : ""}`}
      onClick={handleClick}
      aria-label={status === "idle" ? "Start Agent run" : `Open Agent — ${variant.label}`}
    >
      <Bot className="h-3 w-3" />
      <span>{variant.label}</span>
    </button>
  )
}
