import type { ReactNode } from "react"

import { LazyAgentSurface } from "./LazyAgentSurface"
import { QueueEmptyState } from "./QueueEmptyState"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { useIsMobile } from "@/hooks/use-mobile"

export function AgentModeLayout({
  selectedEntityRef,
  header,
  children,
}: {
  selectedEntityRef: string | null
  /** Optional fixed header rendered above the scrolling list (e.g. the filter strip). */
  header?: ReactNode
  children: ReactNode
}) {
  // A side-by-side split leaves the list a few characters wide on a phone
  const isMobile = useIsMobile()
  return (
    <ResizablePanelGroup
      key={isMobile ? "vertical" : "horizontal"}
      direction={isMobile ? "vertical" : "horizontal"}
      autoSaveId={isMobile ? "agent-mode-panels-mobile" : "agent-mode-panels"}
      className="h-full"
    >
      <ResizablePanel
        defaultSize={42}
        minSize={25}
        maxSize={65}
        className={isMobile ? "flex flex-col border-b overflow-hidden" : "flex flex-col border-r overflow-hidden"}
      >
        {header}
        {/* Scroll region: min-h-0 lets this flex child shrink so the long
            list scrolls within the panel instead of overflowing it. */}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={58} className="flex flex-col overflow-hidden">
        <AgentComposerProvider>
          {selectedEntityRef ? (
            <LazyAgentSurface entity_ref={selectedEntityRef} />
          ) : (
            <QueueEmptyState message="Select a task to view its agent thread." />
          )}
        </AgentComposerProvider>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
