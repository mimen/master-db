import { useRef } from "react"

import { AgentComposer } from "./AgentComposer"
import { AgentTranscript } from "./AgentTranscript"
import { StatusPill } from "./StatusPill"
import { ThinkingIndicator } from "./ThinkingIndicator"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"

function AgentDrawerBody({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
  const startedAtRef = useRef<number | null>(null)
  if (isRunning && startedAtRef.current === null) startedAtRef.current = Date.now()
  if (!isRunning) startedAtRef.current = null

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
