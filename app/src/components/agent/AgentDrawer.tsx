import { VisuallyHidden } from "@radix-ui/react-visually-hidden"

import { AgentSurface } from "./AgentSurface"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"

export function AgentDrawer() {
  const { isOpen, activeEntityRef, close } = useAgentDrawer()
  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="sm:max-w-[640px] p-0 flex flex-col h-full">
        {/* Radix Dialog requires a Title + Description for screen-reader a11y.
            AgentSurface renders its own visible header (plain elements so it can
            mount outside a Sheet in the queue view), so these are visually hidden
            and exist only to satisfy the Dialog accessibility contract. */}
        <VisuallyHidden>
          <SheetTitle>Agent thread{activeEntityRef ? ` for ${activeEntityRef}` : ""}</SheetTitle>
          <SheetDescription>
            Agent transcript, decisions, and composer for the selected entity.
          </SheetDescription>
        </VisuallyHidden>
        <AgentComposerProvider>
          {activeEntityRef ? <AgentSurface entity_ref={activeEntityRef} /> : null}
        </AgentComposerProvider>
      </SheetContent>
    </Sheet>
  )
}
