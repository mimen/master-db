import { useAction, useQuery } from "convex/react"
import { Check } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { toast } from "sonner"

import { AgentComposer } from "./AgentComposer"
import { AgentTranscript } from "./AgentTranscript"
import { StatusPill } from "./StatusPill"
import { ThinkingIndicator } from "./ThinkingIndicator"

import { PriorityBadge, ProjectBadge } from "@/components/badges/shared"
import { Button } from "@/components/ui/button"
import { SheetHeader } from "@/components/ui/sheet"
import { api } from "@/convex/_generated/api"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"

/**
 * Resolve the Todoist task id for the focused entity. Prefer the enriched
 * `entity_id` from meta; fall back to parsing the entity_ref slug
 * ("todoist:task:<id>" → "<id>") so the Complete button still works before
 * meta has loaded.
 */
function resolveTodoistId(
  entity_ref: string,
  entityId: string | null | undefined,
): string | null {
  if (entityId) return entityId
  if (entity_ref.startsWith("todoist:task:")) {
    return entity_ref.slice("todoist:task:".length) || null
  }
  return null
}

export function AgentSurface({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
  const meta = useQuery(api.agentic.queries.getQueueEntityMeta.default, { entity_ref })
  const priority = usePriority(meta?.priority ?? undefined)
  const title = meta?.entity_title ?? entity_ref

  // Complete action: only meaningful for todoist tasks. The action checks the
  // task in Convex + syncs to Todoist; the listAwaitingDecision query already
  // excludes completed tasks, so the queue reactively drops it and advances
  // focus — no manual refetch/focus change needed here.
  const completeTask = useAction(api.todoist.actions.completeTask.completeTask)
  const [isCompleting, setIsCompleting] = useState(false)
  const isTodoistTask =
    meta?.entity_type === "todoist_task" || entity_ref.startsWith("todoist:task:")
  const isChecked = meta?.checked === true
  const todoistId = resolveTodoistId(entity_ref, meta?.entity_id)
  const showComplete = isTodoistTask && !isChecked

  const handleComplete = (e: MouseEvent) => {
    e.stopPropagation()
    if (isCompleting || !todoistId) return
    setIsCompleting(true)
    void (async () => {
      try {
        const res = await completeTask({ todoistId })
        if (!res.success) {
          toast.error(res.error ?? "Failed to complete task")
        }
      } catch (err) {
        console.warn("[agent] complete task failed", err)
        toast.error("Failed to complete task")
      } finally {
        setIsCompleting(false)
      }
    })()
  }

  // Auto-scroll the transcript to the bottom on open / entity change so the
  // latest messages are visible without manual scrolling. Depends on
  // entity_ref (mount + switch) and run?.status so newly-landed content from
  // an active run also pins to the bottom. This is a "scroll on open / state
  // change" baseline — it does not track every incremental message append and
  // does not attempt to preserve a user's manual scroll position.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entity_ref, run?.status])
  const startedAtRef = useRef<number | null>(null)
  if (isRunning && startedAtRef.current === null) startedAtRef.current = Date.now()
  if (!isRunning) startedAtRef.current = null

  // Auto-trigger on mount: idempotency key stable per entity_ref ONLY (not
  // per mount). React 18 StrictMode double-mounts effects in dev — a per-mount
  // key would generate two unique idempotency keys for the same effective
  // "open this entity" action, defeating the server cache and producing
  // duplicate discovery runs. Keying by entity alone collapses StrictMode's
  // double-fire, browser back/forward re-mounts, and tab focus re-mounts into
  // a single cached response (within the server's 24h Idempotency-Key TTL).
  const postRunAction = useAction(api.agentic.actions.postRun.default)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await postRunAction({
          entity_ref,
          message: null,
          idempotency_key: `${entity_ref}:open`,
          multitask_strategy: "enqueue",
        })
        if (cancelled) return
        // accepted=false means no-op (existing run / busy / cached). Convex query renders state regardless.
        void res
      } catch (err) {
        // Engine unreachable: render nothing extra; transcript shows last-known state.
        console.warn("[agent] auto-trigger failed", err)
      }
    })()
    return () => { cancelled = true }
  }, [entity_ref]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <SheetHeader className="px-4 py-3 border-b flex items-start justify-between flex-row gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
          <span className="font-mono text-xs text-muted-foreground truncate">{entity_ref}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {meta?.project && (
              <ProjectBadge
                project={{
                  name: meta.project.name,
                  color: getProjectColor(meta.project.color),
                }}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            {priority?.showFlag && (
              <PriorityBadge priority={priority} onClick={(e) => e.stopPropagation()} />
            )}
          </div>
        </div>
        <p className="sr-only">
          Agent thread for entity {entity_ref}. Transcript, decisions, and composer below.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {showComplete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleComplete}
              disabled={isCompleting || !todoistId}
              aria-label="Complete task"
              title="Complete task"
            >
              <Check />
              Complete
            </Button>
          )}
          <StatusPill status={run?.status ?? "idle"} />
        </div>
      </SheetHeader>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        <AgentTranscript entity_ref={entity_ref} />
        {isRunning && startedAtRef.current && (
          <ThinkingIndicator startedAt={startedAtRef.current} />
        )}
      </div>
      <div className="border-t p-3">
        <AgentComposer entity_ref={entity_ref} isRunning={isRunning} />
      </div>
    </>
  )
}
