import { useAction, useQuery } from "convex/react"
import { useEffect, useRef } from "react"

import { AgentComposer } from "./AgentComposer"
import { AgentTranscript } from "./AgentTranscript"
import { StatusPill } from "./StatusPill"
import { ThinkingIndicator } from "./ThinkingIndicator"

import { PriorityBadge, ProjectBadge } from "@/components/badges/shared"
import { SheetHeader } from "@/components/ui/sheet"
import { api } from "@/convex/_generated/api"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"

export function AgentSurface({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
  const meta = useQuery(api.agentic.queries.getQueueEntityMeta.default, { entity_ref })
  const priority = usePriority(meta?.priority ?? undefined)
  const title = meta?.entity_title ?? entity_ref

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
        <StatusPill status={run?.status ?? "idle"} />
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
