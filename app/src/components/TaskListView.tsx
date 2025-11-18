import { useQuery } from "convex/react"
import { useMemo } from "react"

import { BaseListView, TaskListItem } from "@/components/list-items"
import { useFocusContext } from "@/contexts/FocusContext"
import { api } from "@/convex/_generated/api"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import type { ListInstance, ListQueryInput } from "@/lib/views/types"
import { taskSortOptions, taskGroupOptions } from "@/lib/views/entityConfigs/taskConfig"
import type {
  TodoistItemsByListWithProjects,
  TodoistLabelDoc,
  TodoistProject,
  TodoistProjects,
  TodoistTaskWithProject,
} from "@/types/convex/todoist"

interface TaskListViewProps {
  list: ListInstance
  onTaskCountChange?: (listId: string, count: number) => void
  onTaskClick?: (listId: string, taskIndex: number) => void
  focusedTaskIndex: number | null
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean
}

export function TaskListView({
  list,
  onTaskCountChange,
  onTaskClick,
  focusedTaskIndex,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false
}: TaskListViewProps) {
  const { setFocusedTask } = useFocusContext()

  // Fetch support data (always fetch if we need them for grouping)
  const projects: TodoistProjects | undefined = useQuery(
    api.todoist.queries.getProjects.getProjects,
    {} // Always fetch - needed for project/label grouping
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
  const isProjectView = list.query.type === "project" || list.query.type === "inbox"

  // BaseListView handles all list-level rendering (header, empty state, collapse, focus, count)
  return (
    <BaseListView<TodoistTaskWithProject>
      entities={visibleTasks}
      entityType="task"
      getEntityId={(task) => task.todoist_id}
      list={list}
      isMultiListView={isMultiListView}
      isDismissed={isDismissed}
      onDismiss={onDismiss}
      onRestore={onRestore}
      isLoading={isLoading}
      focusedIndex={focusedTaskIndex}
      setFocusedEntity={() => {}}
      setFocusedEntityInContext={setFocusedTask}
      useEntityShortcuts={useTaskDialogShortcuts}
      onEntityCountChange={onTaskCountChange}
      onEntityClick={onTaskClick}
      sortOptions={taskSortOptions}
      groupOptions={taskGroupOptions}
      groupData={{ projects, labels }}
      renderRow={(task, index, ref) => (
        <TaskListItem
          key={task._id}
          task={task}
          onElementRef={ref}
          onClick={() => onTaskClick?.(list.id, index)}
          isProjectView={isProjectView}
          allLabels={labels}
        />
      )}
    />
  )
}
