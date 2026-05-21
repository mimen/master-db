import { useQuery } from "convex/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useSearch } from "wouter"

import { AgentModeLayout } from "@/components/agent/AgentModeLayout"
import { AgentModeToggle, type ViewMode } from "@/components/agent/AgentModeToggle"
import { QueueFilterBar } from "@/components/agent/QueueFilterBar"
import { RunAgentOnListButton } from "@/components/agent/RunAgentOnListButton"
import { BaseListView, TaskListItem } from "@/components/list-items"
import { ViewSettingsDropdown } from "@/components/ui/ViewSettingsDropdown"
import { useHeaderSlotContent } from "@/contexts/HeaderSlotContext"
import { api } from "@/convex/_generated/api"
import { useListViewSettings } from "@/hooks/list-items/useListViewSettings"
import { useAgentQueueKeybindings } from "@/hooks/useAgentQueueKeybindings"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { type AgentFilterKey, filterByAgent, mergeAgentOverlay, OPEN_STATUSES } from "@/lib/agent/agentOverlay"
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

/** Parse the initial selected task (entity_ref) from the URL `?task=` param. */
function readTaskFromSearch(search: string): string | null {
  const task = new URLSearchParams(search).get("task")
  return task && task.length > 0 ? task : null
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

  // The URL search string is the source of truth for the agent filter
  // (`?status=`), the view mode (`?mode=`), and the initially-selected task
  // (`?task=`). `useLocation` returns the pathname only, so writing the search
  // string never affects view resolution.
  const search = useSearch()
  const [, navigate] = useLocation()

  // Selected task ref, drives the right-pane AgentSurface in agent mode. Seeded
  // once from `?task=` on mount; after that, state is the source of truth and
  // the URL is a write target (mirroring the retiring QueueView).
  const [selectedRef, setSelectedRef] = useState<string | null>(() =>
    readTaskFromSearch(search)
  )

  // Tracks an explicit user clear (Escape). Suppresses the auto-focus effect so
  // a deliberate "no selection" isn't immediately re-populated with the first
  // row. Reset whenever the selection is set to a real ref again.
  const userClearedRef = useRef(false)

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

  // When the list is already filtered to a single agent status, the per-row
  // status badge is redundant — hide it. (all-open / closed / no-run keep it.)
  const hideAgentStatus = (OPEN_STATUSES as readonly string[]).includes(agentFilter)

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
  const { currentSort, setCurrentSort, currentGroup, setCurrentGroup } = useListViewSettings(list.id, defaultSort)
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

  // Single entry point for changing the selection in agent mode. Updates state,
  // mirrors it into `?task=` (merging into the live search params so `?mode=` /
  // `?status=` survive; removing `task` when null), and tracks explicit clears
  // so the auto-focus effect doesn't fight an intentional Escape. State is the
  // source of truth post-mount; the URL is purely a write target here.
  const selectRef = useCallback(
    (next: string | null) => {
      userClearedRef.current = next === null
      setSelectedRef(next)
      const params = new URLSearchParams(search)
      if (next) {
        params.set("task", next)
      } else {
        params.delete("task")
      }
      const qs = params.toString()
      navigate(qs ? `?${qs}` : "", { replace: true })
    },
    [navigate, search]
  )

  // Auto-focus the first ordered row when nothing is selected (or the selected
  // ref dropped out of the current list), mirroring QueueView. Skipped after an
  // explicit Escape (userClearedRef) so a deliberate clear isn't overridden.
  // Loop guard: once focus lands on a present ref, indexOf >= 0 and selectedRef
  // != null, so the condition short-circuits. Standard mode is gated out.
  const firstRef = orderedRefs.length > 0 ? orderedRefs[0] : null
  const selectedInOrder = selectedRef !== null && orderedRefs.indexOf(selectedRef) >= 0
  useEffect(() => {
    if (!effectiveAgentMode) return
    if (userClearedRef.current) return
    if (firstRef && !selectedInOrder) {
      selectRef(firstRef)
    }
  }, [effectiveAgentMode, firstRef, selectedInOrder, selectRef])

  useAgentQueueKeybindings({
    enabled: effectiveAgentMode,
    onNext: () => {
      if (orderedRefs.length === 0) return
      const idx = selectedRef ? orderedRefs.indexOf(selectedRef) : -1
      const next = idx === -1 ? 0 : Math.min(idx + 1, orderedRefs.length - 1)
      selectRef(orderedRefs[next])
    },
    onPrev: () => {
      if (orderedRefs.length === 0) return
      const idx = selectedRef ? orderedRefs.indexOf(selectedRef) : -1
      const prev = idx === -1 ? 0 : Math.max(idx - 1, 0)
      selectRef(orderedRefs[prev])
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
    onClearFocus: () => selectRef(null),
  })

  // In agent mode, a row click selects the task into the right pane (and still
  // forwards onTaskClick for any parent-level wiring). Standard mode is unchanged.
  const handleEntityClick = (listId: string, todoistId: string) => {
    if (effectiveAgentMode) {
      selectRef(`todoist:task:${todoistId}`)
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
      // Agent mode: TaskListView owns the single useListViewSettings instance and
      // drives BaseListView's sort/group via controlled props, so the relocated
      // dropdown (rendered in the filter strip below) actually re-sorts the list.
      // The header view-settings slot is suppressed to avoid a duplicate control.
      // Standard mode passes none of these -> BaseListView's own header dropdown.
      sortValue={effectiveAgentMode ? currentSort : undefined}
      onSortChange={effectiveAgentMode ? setCurrentSort : undefined}
      groupValue={effectiveAgentMode ? currentGroup : undefined}
      onGroupChange={effectiveAgentMode ? setCurrentGroup : undefined}
      hideViewSettings={effectiveAgentMode}
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
          agentMode={effectiveAgentMode}
          hideAgentStatus={hideAgentStatus}
          onAgentSelect={selectRef}
        />
      )}
    />
  )

  if (effectiveAgentMode) {
    // Filter strip = the agent status filters + the relocated sort dropdown,
    // sitting together as one top-of-list row. The sort dropdown is wired to
    // TaskListView's single useListViewSettings instance (also passed to
    // BaseListView as controlled props), so changing it actually re-sorts.
    // QueueFilterBar carries its own padding; the wrapper only adds the trailing
    // gap + right padding for the dropdown so the strip reads as one unit.
    return (
      <AgentModeLayout
        selectedEntityRef={selectedRef}
        header={
          <div className="flex items-center gap-2 border-b pr-2">
            <div className="flex-1 min-w-0">
              <QueueFilterBar filter={agentFilter} onFilterChange={setAgentFilter} />
            </div>
            <ViewSettingsDropdown<TodoistTaskWithProject>
              sortOptions={sortOptions}
              currentSort={currentSort}
              onSortChange={setCurrentSort}
              groupOptions={taskGroupOptions}
              currentGroup={currentGroup}
              onGroupChange={setCurrentGroup}
              triggerLabel="Sort"
            />
          </div>
        }
      >
        {listView}
      </AgentModeLayout>
    )
  }

  return listView
}
