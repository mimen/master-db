import type { ReactNode } from "react"

import { AgentSurface } from "./AgentSurface"
import { QueueEmptyState } from "./QueueEmptyState"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"

export function AgentModeLayout({
  selectedEntityRef,
  children,
}: {
  selectedEntityRef: string | null
  children: ReactNode
}) {
  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="agent-mode-panels"
      className="h-full"
    >
      <ResizablePanel
        defaultSize={42}
        minSize={25}
        maxSize={65}
        className="flex flex-col border-r overflow-hidden"
      >
        {children}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={58} className="flex flex-col overflow-hidden">
        <AgentComposerProvider>
          {selectedEntityRef ? (
            <AgentSurface entity_ref={selectedEntityRef} />
          ) : (
            <QueueEmptyState message="Select a task to view its agent thread." />
          )}
        </AgentComposerProvider>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
