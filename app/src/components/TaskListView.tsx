import { useQuery } from "convex/react"
import { useMemo, useState } from "react"

import { AgentModeLayout } from "@/components/agent/AgentModeLayout"
import { RunAgentOnListButton } from "@/components/agent/RunAgentOnListButton"
import { BaseListView, TaskListItem } from "@/components/list-items"
import { api } from "@/convex/_generated/api"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { mergeAgentOverlay } from "@/lib/agent/agentOverlay"
import { taskSortOptions, taskGroupOptions } from "@/lib/views/entityConfigs/taskConfig"
import type { ListInstance, ListQueryInput, ViewParams } from "@/lib/views/types"
import type {
  TodoistItemsByListWithProjects,
  TodoistLabelDoc,
  TodoistProject,
  TodoistProjects,
  TodoistProjectsWithMetadata,
  TodoistTaskWithProject,
} from "@/types/convex/todoist"

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

  // Batch-fetch the per-task agent overlay for the currently visible tasks.
  const entityRefs = useMemo(
    () => visibleTasks.map((task) => `todoist:task:${task.todoist_id}`),
    [visibleTasks]
  )
  const overlay =
    useQuery(
      api.agentic.queries.agentOverlayByEntityRefs.default,
      agentMode ? { entity_refs: entityRefs } : "skip"
    ) ?? {}

  // Decorate tasks with their overlay (only meaningful in agent mode). WithAgent<T>
  // is structurally T, so renderRow / TaskListItem work unchanged.
  const decoratedTasks = useMemo(
    () => mergeAgentOverlay(visibleTasks, overlay),
    [visibleTasks, overlay]
  )

  // In agent mode, a row click selects the task into the right pane (and still
  // forwards onTaskClick for any parent-level wiring). Standard mode is unchanged.
  const handleEntityClick = (listId: string, todoistId: string) => {
    if (agentMode) {
      setSelectedRef(`todoist:task:${todoistId}`)
    }
    onTaskClick?.(listId, todoistId)
  }

  // BaseListView handles all list-level rendering (header, empty state, collapse, focus, count)
  const listView = (
    <BaseListView<TodoistTaskWithProject>
      entities={agentMode ? decoratedTasks : visibleTasks}
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
      sortOptions={taskSortOptions}
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

  if (agentMode) {
    return <AgentModeLayout selectedEntityRef={selectedRef}>{listView}</AgentModeLayout>
  }

  return listView
}
