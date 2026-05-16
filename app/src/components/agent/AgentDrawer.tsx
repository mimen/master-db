import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"

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
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">Transcript lands in Task 7.</p>
        </div>
        <div className="border-t p-3">
          <p className="text-sm text-muted-foreground">Composer lands in Task 11.</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
