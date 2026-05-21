import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useEffect, useState } from "react"

import { AgentSurface } from "./AgentSurface"
import { QueueEmptyState } from "./QueueEmptyState"
import {
  type QueueFilterKey,
  type QueueSort,
  QueueFilterBar,
} from "./QueueFilterBar"
import { QueueRow } from "./QueueRow"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"
import { api } from "@/convex/_generated/api"
import { useAgentQueueKeybindings } from "@/hooks/useAgentQueueKeybindings"

type AwaitingDecisionItem = FunctionReturnType<
  typeof api.agentic.queries.listAwaitingDecision.default
>[number]

const OPEN_STATUSES = ["awaiting_decision", "discovering", "executing", "error"]

export function QueueView() {
  const [filter, setFilter] = useState<QueueFilterKey>("all-open")
  const [sort, setSort] = useState<QueueSort>("urgency")
  const [focused, setFocused] = useState<string | null>(null)

  const queryArgs =
    filter === "closed"
      ? { closed: true, sort }
      : filter === "all-open"
        ? { statuses: OPEN_STATUSES, sort }
        : { statuses: [filter], sort }
  const showStatus = filter === "all-open" || filter === "closed"

  const rows: AwaitingDecisionItem[] | undefined = useQuery(
    api.agentic.queries.listAwaitingDecision.default,
    queryArgs,
  )

  const items = rows ?? []
  const focusedIndex = focused ? items.findIndex((r) => r.entity_ref === focused) : -1

  // Auto-focus the first row when nothing is focused (or the focused entity
  // dropped out of the list). Runs in an effect — never setState during render.
  // Depending on the first item's entity_ref + focusedIndex keeps this from
  // looping: once focus lands on items[0], focusedIndex becomes 0 and the
  // guard short-circuits.
  const firstRef = items.length > 0 ? items[0].entity_ref : null
  useEffect(() => {
    if (firstRef && (focused == null || focusedIndex === -1)) {
      setFocused(firstRef)
    }
  }, [firstRef, focused, focusedIndex])

  useAgentQueueKeybindings({
    enabled: true,
    onNext: () => {
      if (items.length === 0) return
      const idx = focusedIndex === -1 ? 0 : Math.min(focusedIndex + 1, items.length - 1)
      setFocused(items[idx].entity_ref)
    },
    onPrev: () => {
      if (items.length === 0) return
      const idx = focusedIndex === -1 ? 0 : Math.max(focusedIndex - 1, 0)
      setFocused(items[idx].entity_ref)
    },
    onExecuteOption: () => {
      /* TODO Phase 3: bridge keyboard execution into AgentSurface */
    },
    onModify: () => {
      /* TODO Phase 3 */
    },
    onExecuteRecommended: () => {
      /* TODO Phase 3 */
    },
    onClearFocus: () => setFocused(null),
  })

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="agent-queue-panels"
      className="h-full"
    >
      <ResizablePanel
        defaultSize={32}
        minSize={20}
        maxSize={55}
        className="flex flex-col border-r"
      >
        <QueueFilterBar
          filter={filter}
          sort={sort}
          onFilterChange={setFilter}
          onSortChange={setSort}
        />
        {rows === undefined ? (
          <QueueEmptyState message="Loading…" />
        ) : items.length === 0 ? (
          <QueueEmptyState message="Nothing awaiting your decision. Inbox zero." />
        ) : (
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <QueueRow
                key={item.entity_ref}
                item={item}
                focused={item.entity_ref === focused}
                onFocus={setFocused}
                showStatus={showStatus}
              />
            ))}
          </div>
        )}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={68} className="flex flex-col overflow-hidden">
        <AgentComposerProvider>
          {focused ? (
            <AgentSurface entity_ref={focused} />
          ) : (
            <QueueEmptyState message="Select a task to view its agent thread." />
          )}
        </AgentComposerProvider>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
