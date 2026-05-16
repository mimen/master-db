import { AgentComposer } from "./AgentComposer"
import { AgentTranscript } from "./AgentTranscript"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"

function AgentDrawerBody({ entity_ref }: { entity_ref: string }) {
  const { isRunning } = useAgentRuntime(entity_ref)
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <AgentTranscript entity_ref={entity_ref} />
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
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle>
            <span className="font-mono text-xs text-muted-foreground">{activeEntityRef ?? ""}</span>
          </SheetTitle>
        </SheetHeader>
        <AgentComposerProvider>
          {activeEntityRef ? <AgentDrawerBody entity_ref={activeEntityRef} /> : null}
        </AgentComposerProvider>
      </SheetContent>
    </Sheet>
  )
}
