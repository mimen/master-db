/**
 * The per-entity agent run overlay used to decorate/sort/filter the standard
 * task list in agent mode. Mirrors the server-side `AgentOverlay` exported from
 * `convex/agentic/queries/agentOverlayByEntityRefs.ts` — the two must stay
 * identical. Duplicated rather than imported because that source lives outside
 * the app's tsconfig project (only `convex/_generated/**` is in scope).
 */
export interface AgentOverlay {
  hasRun: boolean
  status: string
  last_urgency: number | null
  last_chatted_at: number
}

export type WithAgent<T> = T & { _agent?: AgentOverlay }

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
