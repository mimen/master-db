import { useQuery } from "convex/react"
import { Calendar, Check, ChevronDown, ChevronRight, Flag, FolderOpen, Tag, User } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"

import { api } from "@/convex/_generated/api"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { useTodoistAction } from "@/hooks/useTodoistAction"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn, parseMarkdownLinks } from "@/lib/utils"
import type { ListInstance, ListQueryInput, ListSupportData } from "@/lib/views/types"
import type {
  TodoistItemsByListWithProjects,
  TodoistLabelDoc,
  TodoistProjects,
  TodoistProjectsWithMetadata,
  TodoistTaskWithProject,
} from "@/types/convex/todoist"

const TASK_ROW_FOCUSED_CLASSNAMES = ["bg-muted", "ring-2", "ring-ring"] as const

interface TaskListViewProps {
  list: ListInstance
  onTaskCountChange?: (listId: string, count: number) => void
  onTaskClick?: (listId: string, taskIndex: number) => void
  focusedTaskIndex: number | null
}

export function TaskListView({ list, onTaskCountChange, onTaskClick, focusedTaskIndex }: TaskListViewProps) {
  const [isExpanded, setIsExpanded] = useState(list.startExpanded)

  const projects: TodoistProjects | undefined = useQuery(
    api.todoist.publicQueries.getProjects,
    list.dependencies.projects ? {} : "skip"
  )

  const projectsWithMetadata: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.publicQueries.getProjectsWithMetadata,
    list.dependencies.projectMetadata ? {} : "skip"
  )

  const labels: TodoistLabelDoc[] | undefined = useQuery(
    api.todoist.publicQueries.getLabels,
    list.dependencies.labels ? {} : "skip"
  )

  const taskRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])
  const lastFocusedIndex = useRef<number | null>(null)

  const supportData: ListSupportData = {
    projects: list.dependencies.projects ? projects : undefined,
    projectsWithMetadata: list.dependencies.projectMetadata ? projectsWithMetadata : undefined,
    labels: list.dependencies.labels ? labels : undefined,
  }

  const resolvedQuery = useMemo<ListQueryInput | null>(() => {
    if (list.query.type === "inbox") {
      if (!projects) return null

      const inboxProject = projects.find(
        (project) =>
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

  const tasks: TodoistItemsByListWithProjects | undefined = useQuery(
    api.todoist.publicQueries.getItemsByViewWithProjects,
    resolvedQuery ? { list: resolvedQuery } : "skip"
  )

  const resolvedTasks = tasks ?? []
  const visibleTasks = list.maxTasks ? resolvedTasks.slice(0, list.maxTasks) : resolvedTasks

  taskRefs.current.length = visibleTasks.length
  refHandlers.current.length = visibleTasks.length

  const focusedTask =
    focusedTaskIndex !== null &&
    focusedTaskIndex >= 0 &&
    focusedTaskIndex < visibleTasks.length
      ? visibleTasks[focusedTaskIndex]
      : null

  useTaskDialogShortcuts(focusedTask)

  useEffect(() => {
    onTaskCountChange?.(list.id, visibleTasks.length)
  }, [list.id, onTaskCountChange, visibleTasks.length])

  useEffect(() => {
    setIsExpanded(list.startExpanded)
  }, [list.id, list.startExpanded])

  useEffect(() => {
    const removeHighlight = (element: HTMLDivElement | null) => {
      if (!element) return
      TASK_ROW_FOCUSED_CLASSNAMES.forEach((className) => element.classList.remove(className))
      element.setAttribute("aria-selected", "false")
    }

    const applyHighlight = (element: HTMLDivElement | null) => {
      if (!element) return
      TASK_ROW_FOCUSED_CLASSNAMES.forEach((className) => element.classList.add(className))
      element.setAttribute("aria-selected", "true")
    }

    if (lastFocusedIndex.current !== null && lastFocusedIndex.current !== focusedTaskIndex) {
      removeHighlight(taskRefs.current[lastFocusedIndex.current])
    }

    if (focusedTaskIndex === null) {
      lastFocusedIndex.current = null
      return
    }

    if (focusedTaskIndex < 0 || focusedTaskIndex >= visibleTasks.length) {
      lastFocusedIndex.current = null
      return
    }

    setIsExpanded(true)
    const node = taskRefs.current[focusedTaskIndex]
    if (!node) {
      lastFocusedIndex.current = null
      return
    }

    if (
      lastFocusedIndex.current !== focusedTaskIndex ||
      !node.classList.contains(TASK_ROW_FOCUSED_CLASSNAMES[0])
    ) {
      applyHighlight(node)
    }

    if (typeof document !== "undefined" && node !== document.activeElement) {
      node.focus({ preventScroll: true })
    }

    const scrollContainer = node.closest("[data-task-scroll-container]") as HTMLElement | null
    if (scrollContainer) {
      const nodeRect = node.getBoundingClientRect()
      const containerRect = scrollContainer.getBoundingClientRect()
      const isAbove = nodeRect.top < containerRect.top
      const isBelow = nodeRect.bottom > containerRect.bottom
      if (isAbove || isBelow) {
        node.scrollIntoView({ block: "nearest", inline: "nearest" })
      }
    } else if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest", inline: "nearest" })
    }

    lastFocusedIndex.current = focusedTaskIndex
  }, [focusedTaskIndex, visibleTasks.length])

  const header = list.getHeader({
    params: list.params,
    taskCount: visibleTasks.length,
    support: supportData,
  })

  const emptyState = list.getEmptyState({
    params: list.params,
    taskCount: visibleTasks.length,
    support: supportData,
  })

  const isLoading = resolvedQuery === null || tasks === undefined

  const toggleExpanded = () => {
    setIsExpanded((prev) => !prev)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading tasks...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex items-center gap-2">
        {list.collapsible && (
          <button
            onClick={toggleExpanded}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
        )}
        {header.icon}
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{header.title}</h1>
          {header.description && (
            <p className="text-muted-foreground mt-1">{header.description}</p>
          )}
        </div>
      </div>

      {isExpanded && (
        <>
          {visibleTasks.length > 0 ? (
            <div className="space-y-1">
              {visibleTasks.map((task, index) => {
                if (!refHandlers.current[index]) {
                  refHandlers.current[index] = (element) => {
                    taskRefs.current[index] = element
                    if (element === null && lastFocusedIndex.current === index) {
                      lastFocusedIndex.current = null
                    }
                  }
                }

                return (
                  <TaskRow
                    key={task._id}
                    task={task}
                    onElementRef={refHandlers.current[index]!}
                    onClick={() => onTaskClick?.(list.id, index)}
                  />
                )
              })}
            </div>
          ) : list.collapsible ? (
            <div className="py-1 text-xs text-muted-foreground/50 text-center">Empty</div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-xl font-semibold mb-2">{emptyState.title}</p>
              {emptyState.description && (
                <p className="text-muted-foreground">{emptyState.description}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface TaskRowProps {
  task: TodoistTaskWithProject
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
}

const TaskRow = memo(function TaskRow({ task, onElementRef, onClick }: TaskRowProps) {
  const completeTask = useTodoistAction(
    api.todoist.actions.completeTask.completeTask,
    {
      loadingMessage: "Completing task...",
      successMessage: "Task completed!",
      errorMessage: "Failed to complete task"
    }
  )
  const priority = usePriority(task.priority)

  const handleComplete = async () => {
    await completeTask({ todoistId: task.todoist_id })
  }

  const formatDueDate = (due: TodoistTaskWithProject["due"]) => {
    if (!due) return { text: null, isOverdue: false }

    const date = new Date(due.date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    date.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const isOverdue = date < today
    let text = ""

    if (date.toDateString() === today.toDateString()) {
      text = "Today"
    } else if (date.toDateString() === tomorrow.toDateString()) {
      text = "Tomorrow"
    } else if (isOverdue) {
      const daysOverdue = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      text = daysOverdue === 1 ? "Yesterday" : `${daysOverdue} days overdue`
    } else {
      text = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      })
    }

    return { text, isOverdue }
  }

  const assignee = task.assigned_by_uid || task.responsible_uid
  const markdownSegments = parseMarkdownLinks(task.content)

  const dueInfo = formatDueDate(task.due)

  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-md border border-transparent bg-background p-3 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
        "hover:border-border hover:bg-muted/50"
      )}
    >
      <button
        onClick={(event) => {
          event.stopPropagation()
          void handleComplete()
        }}
        className={cn(
          "group mt-1 flex h-5 w-5 items-center justify-center rounded-full border-[1.75px] border-muted-foreground/40 bg-background transition-colors",
          priority?.colorClass && "border-current",
          priority?.colorClass
        )}
        aria-label="Complete task"
      >
        <Check className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>

      <div className="flex-1 space-y-1">
        <div className="font-medium">
          {markdownSegments.map((segment, index) =>
            segment.type === "text" ? (
              <span key={index}>{segment.content}</span>
            ) : (
              <a
                key={index}
                href={segment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                onClick={(event) => event.stopPropagation()}
              >
                {segment.content}
              </a>
            )
          )}
        </div>

        {task.description && (
          <p className="text-xs text-muted-foreground">{task.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {task.project && (
            <span className="inline-flex items-center gap-1">
              <FolderOpen
                className="h-3 w-3"
                style={{ color: getProjectColor(task.project.color) }}
              />
              {task.project.name}
            </span>
          )}

          {task.due?.date && (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                dueInfo.isOverdue && "text-destructive"
              )}
            >
              <Calendar className="h-3 w-3" />
              {dueInfo.text}
            </span>
          )}

          {task.assigned_by_uid && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              {assignee}
            </span>
          )}

          {task.labels && task.labels.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {task.labels.join(", ")}
            </span>
          )}

          {priority?.showFlag && (
            <span className={cn("inline-flex items-center gap-1", priority.colorClass)}>
              <Flag className="h-3 w-3" fill="currentColor" />
              {priority.label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
