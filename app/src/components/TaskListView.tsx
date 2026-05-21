import { useQuery } from "convex/react"
import { useCallback, useMemo, useState } from "react"
import { useLocation, useSearch } from "wouter"

import { AgentModeLayout } from "@/components/agent/AgentModeLayout"
import { AgentModeToggle, type ViewMode } from "@/components/agent/AgentModeToggle"
import { QueueFilterBar } from "@/components/agent/QueueFilterBar"
import { RunAgentOnListButton } from "@/components/agent/RunAgentOnListButton"
import { BaseListView, TaskListItem } from "@/components/list-items"
import { useHeaderSlotContent } from "@/contexts/HeaderSlotContext"
import { api } from "@/convex/_generated/api"
import { useListViewSettings } from "@/hooks/list-items/useListViewSettings"
import { useAgentQueueKeybindings } from "@/hooks/useAgentQueueKeybindings"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { type AgentFilterKey, filterByAgent, mergeAgentOverlay } from "@/lib/agent/agentOverlay"
import { agentSortOptions, taskSortOptions, taskGroupOptions } from "@/lib/views/entityConfigs/taskConfig"
import { applyGroupingAndSorting } from "@/lib/views/sortAndGroup"
import type { ListInstance, ListQueryInput, ViewParams } from "@/lib/views/types"
import type {
  TodoistItemsByListWithProjects,
  TodoistLabelDoc,
  TodoistProject,
  TodoistProjects,
  TodoistProjectsWithMetadata,
  TodoistTaskWithProject,
} from "@/types/convex/todoist"

const AGENT_FILTER_KEYS: AgentFilterKey[] = [
  "all-open",
  "closed",
  "awaiting_decision",
  "discovering",
  "executing",
  "error",
  "no-run",
]

const DEFAULT_AGENT_FILTER: AgentFilterKey = "all-open"

function isAgentFilterKey(value: string | null): value is AgentFilterKey {
  return value !== null && (AGENT_FILTER_KEYS as string[]).includes(value)
}

/** Parse the initial agent filter from the URL `?status=` param. */
function readAgentFilterFromSearch(search: string): AgentFilterKey {
  const status = new URLSearchParams(search).get("status")
  return isAgentFilterKey(status) ? status : DEFAULT_AGENT_FILTER
}

/** Parse the view mode from the URL `?mode=` param. `mode=agent` => agent. */
function readModeFromSearch(search: string): ViewMode {
  return new URLSearchParams(search).get("mode") === "agent" ? "agent" : "standard"
}

interface TaskListViewProps {
  list: ListInstance<ViewParams>
  onTaskCountChange?: (listId: string, count: number) => void
  onTaskClick?: (listId: string, entityId: string) => void
  focusedEntityId: string | null
  onEntityRemoved?: (listId: string, entityId: string) => void
  onEntitiesChange?: (listId: string, entities: unknown[]) => void
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean
  /**
   * Read-only agent mode. When true, decorates the fetched tasks with their
   * per-task agent overlay and renders the list inside a two-pane
   * AgentModeLayout where row selection drives the right-pane AgentSurface.
   * Standard mode (default) is unchanged: the overlay query is skipped and no
   * layout wrapper is applied.
   */
  agentMode?: boolean
}

export function TaskListView({
  list,
  onTaskCountChange,
  onTaskClick,
  focusedEntityId,
  onEntityRemoved,
  onEntitiesChange,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false,
  agentMode = false
}: TaskListViewProps) {
  // Fetch support data (always fetch if we need them for grouping)
  const projects: TodoistProjects | undefined = useQuery(
    api.todoist.queries.getProjects.getProjects,
    {} // Always fetch - needed for project/label grouping
  )

  const projectsWithMetadata: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata,
    {} // Fetch for list headers
  )

  const labels: TodoistLabelDoc[] | undefined = useQuery(
    api.todoist.queries.getLabels.getLabels,
    {} // Always fetch - needed for label grouping
  )

  // Resolve inbox project if needed
  const resolvedQuery = useMemo<ListQueryInput | null>(() => {
    if (list.query.type === "inbox") {
      if (!projects) return null

      const inboxProject = projects.find(
        (project: TodoistProject) =>
          project.name === "Inbox" &&
          !project.parent_id &&
          !project.is_deleted &&
          !project.is_archived
      )

      if (!inboxProject) return null

      return {
        ...list.query,
        inboxProjectId: inboxProject.todoist_id,
      }
    }

    return list.query
  }, [list.query, projects])

  // Fetch tasks
  const tasks: TodoistItemsByListWithProjects | undefined = useQuery(
    api.todoist.queries.getItemsByViewWithProjects.getItemsByViewWithProjects,
    resolvedQuery ? { list: resolvedQuery } : "skip"
  )

  const resolvedTasks = tasks ?? []
  const visibleTasks = list.maxTasks ? resolvedTasks.slice(0, list.maxTasks) : resolvedTasks

  const isLoading = resolvedQuery === null || tasks === undefined

  // Create list with resolved query (important for inbox views which need inboxProjectId)
  const listWithResolvedQuery = useMemo(() => {
    if (!resolvedQuery) return list
    return {
      ...list,
      query: resolvedQuery
    }
  }, [list, resolvedQuery])

  // ============= AGENT MODE =============
  // Hooks below are always called (unconditional + stable order). Agent-only
  // behavior is gated via the useQuery "skip" arg and the agentMode flag so
  // standard mode performs no overlay fetch and renders exactly as before.

  // Selected task ref, drives the right-pane AgentSurface in agent mode.
  const [selectedRef, setSelectedRef] = useState<string | null>(null)

  // The URL search string is the source of truth for both the agent filter
  // (`?status=`) and the view mode (`?mode=`). `useLocation` returns the
  // pathname only, so writing the search string never affects view resolution.
  const search = useSearch()
  const [, navigate] = useLocation()

  // Effective agent mode = the forced-on prop (e.g. the agent-queue preset) OR
  // the URL `?mode=agent` flag, so any single-list task view can flip into the
  // two-pane agent view. The prop stays the always-on signal for agent-queue.
  const urlMode = readModeFromSearch(search)
  const effectiveAgentMode = agentMode || urlMode === "agent"

  // Batch-fetch the per-task agent overlay for the currently visible tasks.
  const entityRefs = useMemo(
    () => visibleTasks.map((task: TodoistTaskWithProject) => `todoist:task:${task.todoist_id}`),
    [visibleTasks]
  )
  const overlay =
    useQuery(
      api.agentic.queries.agentOverlayByEntityRefs.default,
      effectiveAgentMode ? { entity_refs: entityRefs } : "skip"
    ) ?? {}

  // Decorate tasks with their overlay (only meaningful in agent mode). WithAgent<T>
  // is structurally T, so renderRow / TaskListItem work unchanged.
  const decoratedTasks = useMemo(
    () => mergeAgentOverlay(visibleTasks, overlay),
    [visibleTasks, overlay]
  )

  // Header toggle (single-list views only). Writing `?mode=` merges into the
  // existing search params via navigate(replace) so `?status=`/`?task=` survive.
  const setMode = useCallback(
    (next: ViewMode) => {
      const params = new URLSearchParams(search)
      if (next === "agent") {
        params.set("mode", "agent")
      } else {
        params.delete("mode")
      }
      const qs = params.toString()
      navigate(qs ? `?${qs}` : "", { replace: true })
    },
    [navigate, search]
  )
  useHeaderSlotContent(
    "agent-mode-toggle",
    isMultiListView ? null : (
      <AgentModeToggle mode={effectiveAgentMode ? "agent" : "standard"} onChange={setMode} />
    )
  )

  // Agent filter dimension (status + has-run/no-run), seeded from `?status=`
  // and written back on change. Only applied to the rendered entities when
  // agent mode is active; the hooks themselves are unconditional.
  const [agentFilter, setAgentFilterState] = useState<AgentFilterKey>(() =>
    readAgentFilterFromSearch(search)
  )
  const setAgentFilter = useCallback(
    (next: AgentFilterKey) => {
      setAgentFilterState(next)
      const params = new URLSearchParams(search)
      params.set("status", next)
      navigate(`?${params.toString()}`, { replace: true })
    },
    [navigate, search]
  )

  const agentFilteredTasks = useMemo(
    () => filterByAgent(decoratedTasks, agentFilter),
    [decoratedTasks, agentFilter]
  )

  // The sort/group option arrays handed to BaseListView. Hoisted out of the JSX
  // so the keyboard navigation below can replicate BaseListView's displayed
  // order. Default agent sort = "urgency" (mirrors BaseListView's defaultSort).
  const sortOptions = effectiveAgentMode
    ? [...agentSortOptions, ...taskSortOptions]
    : taskSortOptions
  const defaultSort = effectiveAgentMode ? "urgency" : undefined

  // ============= AGENT-MODE KEYBOARD NAVIGATION =============
  // BaseListView owns the displayed order (it applies the active sort/group from
  // localStorage via useListViewSettings + applyGroupingAndSorting). To let j/k
  // traverse the *visible* order, we read the SAME persisted settings (keyed by
  // list.id) and apply the SAME helper to the filtered+decorated tasks here.
  // The hook is always called for stable hook order; navigation only fires when
  // effectiveAgentMode is true (enabled flag).
  const { currentSort, currentGroup } = useListViewSettings(list.id, defaultSort)
  const orderedAgentTasks = useMemo(() => {
    const activeSortOption = sortOptions.find((opt) => opt.id === currentSort)
    const activeGroupOption = taskGroupOptions.find((opt) => opt.id === currentGroup)
    const processed = applyGroupingAndSorting(
      agentFilteredTasks,
      activeSortOption,
      activeGroupOption,
      { projects, labels }
    )
    // applyGroupingAndSorting returns grouped buckets when a group is active;
    // flatten them in group-sort order to match BaseListView's traversal. (We
    // do not exclude collapsed groups here — a minor edge limitation; collapsed
    // groups are still navigable by keyboard.)
    if (Array.isArray(processed) && processed.length > 0 && "groupKey" in (processed[0] as object)) {
      return (processed as { entities: TodoistTaskWithProject[] }[]).flatMap((g) => g.entities)
    }
    return processed as TodoistTaskWithProject[]
  }, [agentFilteredTasks, sortOptions, currentSort, currentGroup, projects, labels])

  const orderedRefs = useMemo(
    () => orderedAgentTasks.map((task) => `todoist:task:${task.todoist_id}`),
    [orderedAgentTasks]
  )

  useAgentQueueKeybindings({
    enabled: effectiveAgentMode,
    onNext: () => {
      if (orderedRefs.length === 0) return
      const idx = selectedRef ? orderedRefs.indexOf(selectedRef) : -1
      const next = idx === -1 ? 0 : Math.min(idx + 1, orderedRefs.length - 1)
      setSelectedRef(orderedRefs[next])
    },
    onPrev: () => {
      if (orderedRefs.length === 0) return
      const idx = selectedRef ? orderedRefs.indexOf(selectedRef) : -1
      const prev = idx === -1 ? 0 : Math.max(idx - 1, 0)
      setSelectedRef(orderedRefs[prev])
    },
    // Decision keys are Phase-3 no-op stubs: executing an option / modifying /
    // executing the recommended action needs an imperative handle into the
    // focused AgentSurface, which owns its own composer state. The original
    // QueueView stubbed these identically.
    onExecuteOption: () => {
      /* TODO Phase 3: bridge keyboard execution into AgentSurface */
    },
    onModify: () => {
      /* TODO Phase 3 */
    },
    onExecuteRecommended: () => {
      /* TODO Phase 3 */
    },
    onClearFocus: () => setSelectedRef(null),
  })

  // In agent mode, a row click selects the task into the right pane (and still
  // forwards onTaskClick for any parent-level wiring). Standard mode is unchanged.
  const handleEntityClick = (listId: string, todoistId: string) => {
    if (effectiveAgentMode) {
      setSelectedRef(`todoist:task:${todoistId}`)
    }
    onTaskClick?.(listId, todoistId)
  }

  // BaseListView handles all list-level rendering (header, empty state, collapse, focus, count)
  const listView = (
    <BaseListView<TodoistTaskWithProject>
      entities={effectiveAgentMode ? agentFilteredTasks : visibleTasks}
      entityType="task"
      getEntityId={(task) => task.todoist_id}
      list={listWithResolvedQuery}
      isMultiListView={isMultiListView}
      isDismissed={isDismissed}
      onDismiss={onDismiss}
      onRestore={onRestore}
      isLoading={isLoading}
      focusedEntityId={focusedEntityId}
      onEntityRemoved={onEntityRemoved}
      useEntityShortcuts={useTaskDialogShortcuts}
      onEntityCountChange={onTaskCountChange}
      onEntitiesChange={onEntitiesChange}
      onEntityClick={handleEntityClick}
      sortOptions={sortOptions}
      defaultSort={defaultSort}
      groupOptions={taskGroupOptions}
      groupData={{ projects, labels }}
      supportData={{ projects, projectsWithMetadata, labels }}
      headerAction={<RunAgentOnListButton entities={visibleTasks} />}
      renderRow={(task, _index, ref, query) => (
        <TaskListItem
          key={task._id}
          task={task}
          onElementRef={ref}
          onClick={() => handleEntityClick(list.id, task.todoist_id)}
          allLabels={labels}
          onEntityRemoved={onEntityRemoved}
          listId={list.id}
          query={query}
        />
      )}
    />
  )

  if (effectiveAgentMode) {
    // Filter-only variant of QueueFilterBar: BaseListView's own sort dropdown
    // (urgency / last-chatted + standard task sorts) owns sorting, so we omit
    // the bar's sort control to avoid two competing sort UIs.
    return (
      <AgentModeLayout
        selectedEntityRef={selectedRef}
        header={
          <QueueFilterBar filter={agentFilter} onFilterChange={setAgentFilter} />
        }
      >
        {listView}
      </AgentModeLayout>
    )
  }

  return listView
}
