import { useAction } from "convex/react"
import { Bot } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ulid } from "ulid"

import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import type { TodoistTaskWithProject } from "@/types/convex/todoist"

/**
 * Header-level bulk action that kicks off agent discovery for every incomplete
 * task in the current list that doesn't already have an agentic run.
 *
 * Server-side dedup: the engine returns `accepted: false` when a null-message
 * call hits an existing run (per the spec's POST /run semantics). We count
 * those as "skipped" and show a sonner toast with the totals.
 *
 * Concurrency: fires all calls in parallel via Promise.all. The engine's
 * per-entity queue serializes work for each entity_ref, so there's no race.
 * For very large lists we could cap concurrency, but typical list sizes
 * (<100) are fine.
 */

export interface RunAgentOnListButtonProps {
  entities: TodoistTaskWithProject[]
}

export function RunAgentOnListButton({ entities }: RunAgentOnListButtonProps) {
  const postRunAction = useAction(api.agentic.actions.postRun.default)
  const [busy, setBusy] = useState(false)

  const incomplete = entities.filter((t) => !t.checked && !t.is_completed)

  if (incomplete.length === 0) return null

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    const t = toast.loading(`Kicking off agent on ${incomplete.length} task${incomplete.length === 1 ? "" : "s"}…`)
    try {
      const results = await Promise.allSettled(
        incomplete.map((task) =>
          postRunAction({
            entity_ref: `todoist:task:${task.todoist_id}`,
            message: null,
            idempotency_key: ulid(),
            multitask_strategy: "enqueue",
          }),
        ),
      )
      let started = 0
      let skipped = 0
      let failed = 0
      for (const r of results) {
        if (r.status === "rejected") failed++
        else if (r.value?.accepted) started++
        else skipped++
      }
      const parts: string[] = []
      if (started) parts.push(`started ${started}`)
      if (skipped) parts.push(`${skipped} already had runs`)
      if (failed) parts.push(`${failed} failed`)
      toast.success(`Agent: ${parts.join(", ")}`, { id: t })
    } catch (err) {
      toast.error(`Agent bulk start failed: ${(err as Error).message}`, { id: t })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5 h-7 text-xs"
      onClick={handleClick}
      disabled={busy}
      aria-label={`Run agent on ${incomplete.length} tasks without existing runs`}
    >
      <Bot className="h-3 w-3" />
      <span>{busy ? "Starting…" : `Run agent (${incomplete.length})`}</span>
    </Button>
  )
}
