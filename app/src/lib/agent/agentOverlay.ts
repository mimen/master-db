/**
 * The per-entity agent run overlay used to decorate/sort/filter the standard
 * task list in agent mode. Mirrors the server-side `AgentOverlay` exported from
 * `convex/agentic/queries/agentOverlayByEntityRefs.ts` — the two must stay
 * identical. Duplicated rather than imported because that source lives outside
 * the app's tsconfig project (only `convex/_generated/**` is in scope).
 */
import type { QueueFilterKey } from "@/components/agent/QueueFilterBar"

export interface AgentOverlay {
  hasRun: boolean
  status: string
  last_urgency: number | null
  last_chatted_at: number
}

export type WithAgent<T> = T & { _agent?: AgentOverlay }

/**
 * Open run statuses (mirrors the OPEN set in convex/agentic/types/runStatus.ts —
 * everything except `idle`). A run in one of these is still in flight / needs
 * attention; anything else (e.g. `idle`) is treated as "closed".
 */
export const OPEN_STATUSES = ["awaiting_decision", "discovering", "executing", "error"] as const

/**
 * The agent-mode filter dimension. Extends the queue's single-select filter
 * with `"no-run"` (tasks that have never had an agentic run).
 */
export type AgentFilterKey = QueueFilterKey | "no-run"

/**
 * Filter decorated tasks by their agent overlay (`_agent`).
 *
 * - `"all-open"`  → has a run whose status is open (awaiting/discovering/executing/error).
 * - `"closed"`    → has a run whose status is NOT open. Note: the overlay carries
 *   no `checked`/completion flag, so "closed" here means "ran and is no longer
 *   open" (status-derived) rather than "task is checked off". A richer notion of
 *   closed can land once the overlay carries completion. Deferred.
 * - a single status (awaiting_decision/discovering/executing/error) → exact match.
 * - `"no-run"`    → no `_agent` overlay at all (never ran).
 *
 * Pure; preserves input order.
 */
export function filterByAgent<T>(tasks: WithAgent<T>[], filter: AgentFilterKey): WithAgent<T>[] {
  const isOpen = (status: string): boolean => (OPEN_STATUSES as readonly string[]).includes(status)
  return tasks.filter((t) => {
    const agent = t._agent
    switch (filter) {
      case "no-run":
        return agent === undefined
      case "all-open":
        return agent !== undefined && isOpen(agent.status)
      case "closed":
        return agent !== undefined && !isOpen(agent.status)
      default:
        return agent?.status === filter
    }
  })
}

/**
 * Attach the per-task agent overlay onto each task, keyed by
 * `todoist:task:<todoist_id>`. Tasks with no overlay entry pass through
 * unchanged (no `_agent` property).
 */
export function mergeAgentOverlay<T extends { todoist_id: string }>(
  tasks: T[],
  overlay: Record<string, AgentOverlay>,
): WithAgent<T>[] {
  return tasks.map((t) => {
    const a = overlay[`todoist:task:${t.todoist_id}`]
    return a ? { ...t, _agent: a } : t
  })
}
