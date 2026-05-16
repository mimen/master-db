import { useAction } from "convex/react"
import { useEffect, useRef } from "react"

import { AgentComposer } from "./AgentComposer"
import { AgentTranscript } from "./AgentTranscript"
import { StatusPill } from "./StatusPill"
import { ThinkingIndicator } from "./ThinkingIndicator"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { api } from "@/convex/_generated/api"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"

function AgentDrawerBody({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
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
      <SheetHeader className="px-4 py-3 border-b flex items-center justify-between flex-row">
        <SheetTitle className="text-sm">
          <span className="font-mono text-xs text-muted-foreground">{entity_ref}</span>
        </SheetTitle>
        <StatusPill status={run?.status ?? "idle"} />
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
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

export function AgentDrawer() {
  const { isOpen, activeEntityRef, close } = useAgentDrawer()
  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="sm:max-w-[640px] p-0 flex flex-col h-full">
        <AgentComposerProvider>
          {activeEntityRef ? <AgentDrawerBody entity_ref={activeEntityRef} /> : null}
        </AgentComposerProvider>
      </SheetContent>
    </Sheet>
  )
}
