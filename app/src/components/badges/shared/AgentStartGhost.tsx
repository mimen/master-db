import { useAction, useQuery } from "convex/react"
import { Bot } from "lucide-react"
import { ulid } from "ulid"

import { GhostBadge } from "./GhostBadge"

import { api } from "@/convex/_generated/api"

/**
 * Hover-only "+Agent" ghost button — shown when the entity has no
 * `agenticRuns` row yet. Clicking it fires a discovery run (POST /run
 * with message=null) but does NOT open the drawer. Once the run exists,
 * AgentStatusBadge takes over and is shown persistently.
 *
 * Mirrors the pattern of `+label` / `+priority` ghost badges that surface
 * only on row hover for unset properties.
 */

export interface AgentStartGhostProps {
  entity_ref: string
}

export function AgentStartGhost({ entity_ref }: AgentStartGhostProps) {
  const run = useQuery(api.agentic.queries.getRun.default, { entity_ref })
  const postRunAction = useAction(api.agentic.actions.postRun.default)

  // Hide while loading OR when a run row already exists. The AgentStatusBadge
  // in the persistent badge area covers the row-exists case.
  if (run !== null) return null

  return (
    <GhostBadge
      icon={Bot}
      text="Agent"
      onClick={(e) => {
        e.stopPropagation()
        void postRunAction({
          entity_ref,
          message: null,
          idempotency_key: ulid(),
          multitask_strategy: "enqueue",
        }).catch((err) => console.warn("[agent-start-ghost] start failed", err))
      }}
    />
  )
}
