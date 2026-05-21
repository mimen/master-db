import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { useCallback, useEffect, useState } from "react"
import { useLocation, useSearch } from "wouter"

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

const QUEUE_FILTER_KEYS: QueueFilterKey[] = [
  "all-open",
  "closed",
  "awaiting_decision",
  "discovering",
  "executing",
  "error",
]

const DEFAULT_FILTER: QueueFilterKey = "awaiting_decision"

function isQueueFilterKey(value: string | null): value is QueueFilterKey {
  return value !== null && (QUEUE_FILTER_KEYS as string[]).includes(value)
}

/** Parse the initial filter from the URL search string. */
function readFilterFromSearch(search: string): QueueFilterKey {
  const status = new URLSearchParams(search).get("status")
  return isQueueFilterKey(status) ? status : DEFAULT_FILTER
}

/** Parse the initial focused task (entity_ref) from the URL search string. */
function readTaskFromSearch(search: string): string | null {
  const task = new URLSearchParams(search).get("task")
  return task && task.length > 0 ? task : null
}

export function QueueView() {
  // The router is the source of truth for `filter` + `focused`; we mirror it
  // into local state for responsiveness and seed it once from the URL on mount.
  // `useLocation` returns the pathname only (no query string), so navigating
  // to `/agent?status=…&task=…` does not affect view resolution in
  // pathToViewKey — only the search string carries our state.
  const search = useSearch()
  const [, navigate] = useLocation()

  const [filter, setFilterState] = useState<QueueFilterKey>(() =>
    readFilterFromSearch(search),
  )
  const [sort, setSort] = useState<QueueSort>("urgency")
  const [focused, setFocusedState] = useState<string | null>(() =>
    readTaskFromSearch(search),
  )

  // Write the current filter/task to `/agent?status=…&task=…`, preserving the
  // param we are not changing. `replace: true` keeps j/k navigation from
  // spamming the history stack. Reads the live URL via the captured `search`
  // string so we never clobber the sibling param.
  const writeUrl = useCallback(
    (nextFilter: QueueFilterKey, nextTask: string | null) => {
      const params = new URLSearchParams()
      params.set("status", nextFilter)
      if (nextTask) params.set("task", nextTask)
      navigate(`/agent?${params.toString()}`, { replace: true })
    },
    [navigate],
  )

  const setFilter = useCallback(
    (next: QueueFilterKey) => {
      setFilterState(next)
      // Changing the filter reloads the list; drop the task so a stale ref
      // doesn't linger in the URL — auto-focus will repopulate it.
      setFocusedState(null)
      writeUrl(next, null)
    },
    [writeUrl],
  )

  const setFocused = useCallback(
    (next: string | null) => {
      setFocusedState(next)
      writeUrl(filter, next)
    },
    [writeUrl, filter],
  )

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

  // Auto-focus the first row when nothing is focused (or the focused entity —
  // including a `?task=` restored from the URL — is not in the current list).
  // A valid restored task has focusedIndex >= 0, so the guard short-circuits
  // and we never override it with the first row. Runs in an effect — never
  // setState during render. Depending on the first item's entity_ref +
  // focusedIndex keeps this from looping: once focus lands on items[0],
  // focusedIndex becomes 0 and the guard short-circuits.
  const firstRef = items.length > 0 ? items[0].entity_ref : null
  useEffect(() => {
    if (firstRef && (focused == null || focusedIndex === -1)) {
      setFocusedState(firstRef)
      writeUrl(filter, firstRef)
    }
  }, [firstRef, focused, focusedIndex, filter, writeUrl])

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
