import { useAction, useQuery } from "convex/react"
import { Flag, Calendar, Tag, User, Check, ChevronDown, ChevronRight, Inbox, Clock, AlertCircle } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"

import { api } from "@/convex/_generated/api"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn, parseMarkdownLinks } from "@/lib/utils"
import type { TodoistProject, TodoistProjects, TodoistTask, TodoistItemsByView, TodoistLabelDoc } from "@/types/convex/todoist"
import type { ViewConfig } from "@/types/views"

const TASK_ROW_FOCUSED_CLASSNAMES = ["bg-muted", "ring-2", "ring-ring"] as const

interface TaskListViewProps {
  viewConfig: ViewConfig
  onTaskCountChange?: (viewId: string, count: number) => void
  onTaskClick?: (viewId: string, taskIndex: number) => void
  focusedTaskIndex: number | null
}

export function TaskListView({ viewConfig, onTaskCountChange, onTaskClick, focusedTaskIndex }: TaskListViewProps) {
  const [isExpanded, setIsExpanded] = useState(viewConfig.expanded ?? true)
  const currentView = viewConfig.value
  const projects: TodoistProjects | undefined = useQuery(api.todoist.publicQueries.getProjects)
  const labels: TodoistLabelDoc[] | undefined = useQuery(api.todoist.publicQueries.getLabels)
  const taskRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])
  const lastFocusedIndex = useRef<number | null>(null)

  const inboxProject = projects?.find((project: TodoistProject) =>
    project.name === "Inbox" && !project.parent_id && !project.is_deleted && !project.is_archived
  )

  const tasksArgs = inboxProject || currentView !== "inbox"
    ? { view: currentView, inboxProjectId: inboxProject?.todoist_id }
    : undefined

  const tasks: TodoistItemsByView | undefined = useQuery(
    api.todoist.publicQueries.getItemsByView,
    tasksArgs ?? "skip"
  )

  const filteredTasks = tasks || []
  taskRefs.current.length = filteredTasks.length
  refHandlers.current.length = filteredTasks.length

  const focusedTask = focusedTaskIndex !== null && focusedTaskIndex >= 0 && focusedTaskIndex < filteredTasks.length
    ? filteredTasks[focusedTaskIndex]
    : null

  useTaskDialogShortcuts(focusedTask)

  useEffect(() => {
    onTaskCountChange?.(viewConfig.id, filteredTasks.length)
  }, [filteredTasks.length, onTaskCountChange, viewConfig.id])

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

    if (focusedTaskIndex < 0 || focusedTaskIndex >= filteredTasks.length) {
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
  }, [focusedTaskIndex, filteredTasks.length])

  // Get view title, description and icon
  const getViewInfo = () => {
    switch (currentView) {
      case "inbox":
        return {
          title: "Inbox",
          description: `${filteredTasks.length} tasks to process`,
          icon: <Inbox className="h-6 w-6 mr-3" />
        }
      case "today":
        return {
          title: "Today",
          description: `${filteredTasks.length} tasks due today`,
          icon: <Calendar className="h-6 w-6 mr-3 text-blue-500" />
        }
      case "upcoming":
        return {
          title: "Upcoming",
          description: `${filteredTasks.length} tasks due this week`,
          icon: <Calendar className="h-6 w-6 mr-3 text-green-500" />
        }
      case "time:overdue":
        return {
          title: "Overdue",
          description: `${filteredTasks.length} overdue tasks`,
          icon: <AlertCircle className="h-6 w-6 mr-3 text-red-500" />
        }
      case "time:today":
        return {
          title: "Today",
          description: `${filteredTasks.length} tasks due today`,
          icon: <Calendar className="h-6 w-6 mr-3 text-blue-500" />
        }
      case "time:upcoming":
        return {
          title: "Upcoming",
          description: `${filteredTasks.length} upcoming tasks`,
          icon: <Clock className="h-6 w-6 mr-3 text-green-500" />
        }
      case "time:no-date":
        return {
          title: "No Date",
          description: `${filteredTasks.length} tasks without due dates`,
          icon: <Calendar className="h-6 w-6 mr-3 text-gray-500" />
        }
      default: {
        if (currentView.startsWith("project:")) {
          const projectId = currentView.replace("project:", "")
          const project = projects?.find((p: TodoistProject) => p.todoist_id === projectId)
          return {
            title: project?.name || "Project",
            description: `${filteredTasks.length} tasks in this project`,
            icon: project ? (
              <div
                className="w-3 h-3 rounded-full mr-3 flex-shrink-0"
                style={{ backgroundColor: getProjectColor(project.color) }}
              />
            ) : null
          }
        }
        if (currentView.startsWith("priority:")) {
          const priorityId = currentView.replace("priority:", "")
          const priorityMap: Record<string, { label: string; color: string; level: number }> = {
            "p1": { label: "P1", color: "text-red-500", level: 4 },
            "p2": { label: "P2", color: "text-orange-500", level: 3 },
            "p3": { label: "P3", color: "text-blue-500", level: 2 },
            "p4": { label: "P4", color: "text-gray-500", level: 1 },
          }
          const priorityInfo = priorityMap[priorityId]
          return {
            title: priorityInfo?.label || priorityId.toUpperCase(),
            description: `${filteredTasks.length} tasks with ${priorityInfo?.label || priorityId} priority`,
            icon: priorityInfo ? (
              <Flag className={cn("h-6 w-6 mr-3", priorityInfo.color)} fill="currentColor" />
            ) : null
          }
        }
        if (currentView.startsWith("label:")) {
          const labelName = currentView.replace("label:", "")
          const label = labels?.find((l: TodoistLabelDoc) => l.name === labelName)
          return {
            title: `@${labelName}`,
            description: `${filteredTasks.length} tasks with @${labelName} label`,
            icon: label ? (
              <Tag
                className="h-6 w-6 mr-3"
                style={{ color: getProjectColor(label.color) }}
              />
            ) : (
              <Tag className="h-6 w-6 mr-3 text-muted-foreground" />
            )
          }
        }
        return { title: "Tasks", description: `${filteredTasks.length} tasks`, icon: null }
      }
    }
  }

  const { title, description, icon } = getViewInfo()

  const isLoading = tasks === undefined || (currentView === "inbox" && !inboxProject)

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading tasks...</p>
      </div>
    )
  }

  const getEmptyStateMessage = () => {
    switch (currentView) {
      case "inbox":
        return {
          emoji: "🎉",
          title: "Inbox Zero!",
          description: "All tasks have been processed and moved to projects"
        }
      case "today":
        return {
          emoji: "✅",
          title: "All caught up!",
          description: "No tasks due today"
        }
      case "upcoming":
        return {
          emoji: "📅",
          title: "Nothing upcoming!",
          description: "No tasks due in the next 7 days"
        }
      default:
        return {
          emoji: "📝",
          title: "No tasks here!",
          description: "This view is empty"
        }
    }
  }

  const emptyState = getEmptyStateMessage()

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex items-center gap-2">
        {viewConfig.collapsible && (
          <button
            onClick={toggleExpanded}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </button>
        )}
        {icon}
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{viewConfig.title || title}</h1>
          <p className="text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      {isExpanded && (
        <>
          {filteredTasks.length > 0 ? (
            <div className="space-y-1">
              {filteredTasks.map((task: TodoistTask, index: number) => {
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
                    onClick={() => onTaskClick?.(viewConfig.id, index)}
                  />
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="text-6xl mb-4">{emptyState.emoji}</div>
              <p className="text-xl font-semibold mb-2">{emptyState.title}</p>
              <p className="text-muted-foreground">{emptyState.description}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface TaskRowProps {
  task: TodoistTask
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
}

const TaskRow = memo(function TaskRow({ task, onElementRef, onClick }: TaskRowProps) {
  const completeTask = useAction(api.todoist.actions.completeTask.completeTask)
  const priority = usePriority(task.priority)

  const handleComplete = async () => {
    try {
      await completeTask({ todoistId: task.todoist_id })
    } catch (error) {
      console.error("Failed to complete task:", error)
    }
  }

  const formatDueDate = (due: TodoistTask["due"]) => {
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
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined
      })
    }

    return { text, isOverdue }
  }
  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 p-3 rounded-lg transition-colors focus:outline-none cursor-pointer",
        "hover:bg-muted/50"
      )}
    >
      {/* Checkbox */}
      <button
        onClick={handleComplete}
        className={cn(
          "w-5 h-5 rounded-full border-2 transition-colors flex-shrink-0 flex items-center justify-center",
          "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        )}
      >
        {task.checked && (
          <Check className="w-3 h-3 text-green-600" />
        )}
      </button>

      {/* Task content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-normal">
          {parseMarkdownLinks(task.content).map((part, index) => {
            if (part.type === 'link') {
              return (
                <a
                  key={index}
                  href={part.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {part.content}
                </a>
              )
            }
            return <span key={index}>{part.content}</span>
          })}
        </p>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-1">
            {parseMarkdownLinks(task.description).map((part, index) => {
              if (part.type === 'link') {
                return (
                  <a
                    key={index}
                    href={part.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {part.content}
                  </a>
                )
              }
              return <span key={index}>{part.content}</span>
            })}
          </p>
        )}

        {/* Task metadata */}
        <div className="flex items-center gap-3 mt-2">
          {/* Priority - only show if has priority flag */}
          {priority?.showFlag && (
            <div className="flex items-center gap-1">
              <Flag
                className={cn("h-3.5 w-3.5", priority.colorClass)}
                fill="currentColor"
              />
              <span className="text-xs text-muted-foreground">{priority.uiPriority}</span>
            </div>
          )}

          {/* Due date */}
          {task.due && (() => {
            const { text, isOverdue } = formatDueDate(task.due)
            return text ? (
              <div className={cn(
                "flex items-center gap-1 text-xs",
                isOverdue ? "text-red-500" : "text-muted-foreground"
              )}>
                <Calendar className="h-3 w-3" />
                <span>{text}</span>
              </div>
            ) : null
          })()}

          {/* Labels */}
          {task.labels.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {task.labels.map((label: string) => (
                <span
                  key={label}
                  className="text-xs px-1.5 py-0.5 bg-muted rounded-full"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Assignee */}
          {task.assignee_id && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Assigned</span>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}, (prev, next) => prev.task === next.task && prev.onElementRef === next.onElementRef && prev.onClick === next.onClick)
