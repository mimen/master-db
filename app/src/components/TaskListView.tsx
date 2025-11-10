import { useQuery } from "convex/react"
import { Calendar, Check, ChevronDown, ChevronRight, Flag, FolderOpen, Tag, User, X, RotateCcw } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

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
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const TASK_ROW_FOCUSED_CLASSNAMES = ["bg-muted", "ring-2", "ring-ring"] as const

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

  // Show compact view ONLY in multi-list views for:
  // 1. Empty lists (always compact by default)
  // 2. Dismissed lists (manually collapsed, shows task count)
  const shouldShowCompact = isMultiListView && (visibleTasks.length === 0 || isDismissed)

  if (shouldShowCompact) {
    const taskCountText = visibleTasks.length === 0
      ? "Empty"
      : `${visibleTasks.length} task${visibleTasks.length === 1 ? '' : 's'}`

    return (
      <div className="max-w-4xl mx-auto px-6 py-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
          {header.icon}
          <span className="flex-1">{header.title}</span>
          <span className="text-xs">{taskCountText}</span>
          {visibleTasks.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onRestore?.(list.id)}
                    className="p-1 hover:bg-muted rounded transition-colors"
                    aria-label="Expand list"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Expand list
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {list.collapsible && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleExpanded}
                    className="p-1 hover:bg-muted rounded transition-colors"
                    aria-label={isExpanded ? "Collapse list" : "Expand list"}
                  >
                    {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {isExpanded ? "Collapse" : "Expand"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {header.icon}
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{header.title}</h1>
            {header.description && (
              <p className="text-muted-foreground mt-1">{header.description}</p>
            )}
          </div>
          {isMultiListView && visibleTasks.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onDismiss?.(list.id)}
                    className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground"
                    aria-label="Collapse list"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Collapse list
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <Separator className="mt-3" />
      </div>

      {isExpanded && (
        <>
          {visibleTasks.length > 0 ? (
            <div className="space-y-1">
              {visibleTasks.map((task: TodoistTaskWithProject, index: number) => {
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
  const [isEditing, setIsEditing] = useState(false)
  const [showDescriptionInput, setShowDescriptionInput] = useState(false)
  const [editContent, setEditContent] = useState(task.content)
  const [editDescription, setEditDescription] = useState(task.description || "")
  // UI-level optimistic values - shown while waiting for DB sync
  const [optimisticContent, setOptimisticContent] = useState<string | null>(null)
  const [optimisticDescription, setOptimisticDescription] = useState<string | null>(null)
  const contentInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLInputElement>(null)

  const completeTask = useTodoistAction(
    api.todoist.actions.completeTask.completeTask,
    {
      loadingMessage: "Completing task...",
      successMessage: "Task completed!",
      errorMessage: "Failed to complete task"
    }
  )

  const updateTask = useTodoistAction(
    api.todoist.publicActions.updateTask,
    {
      loadingMessage: "Updating task...",
      successMessage: "Task updated!",
      errorMessage: "Failed to update task"
    }
  )

  const priority = usePriority(task.priority)

  const handleComplete = async () => {
    await completeTask({ todoistId: task.todoist_id })
  }

  const startEditing = useCallback(() => {
    setIsEditing(true)
    // Only show description input if task already has a description
    setShowDescriptionInput(!!task.description)
    // Use real DB values when entering edit mode, not optimistic ones
    setEditContent(task.content)
    setEditDescription(task.description || "")
  }, [task.content, task.description])

  const startEditingDescription = useCallback(() => {
    setIsEditing(true)
    // Always show description input when explicitly editing description
    setShowDescriptionInput(true)
    // Use real DB values when entering edit mode, not optimistic ones
    setEditContent(task.content)
    setEditDescription(task.description || "")
    // Focus description input after state update
    setTimeout(() => {
      descriptionInputRef.current?.focus()
    }, 0)
  }, [task.content, task.description])

  // Expose startEditing and startEditingDescription to parent
  useEffect(() => {
    // Store the functions on the task element for parent access
    const element = document.querySelector(`[data-task-id="${task.todoist_id}"]`) as HTMLElement & {
      startEditing?: () => void
      startEditingDescription?: () => void
    }
    if (element) {
      element.startEditing = startEditing
      element.startEditingDescription = startEditingDescription
    }
  }, [task.todoist_id, startEditing, startEditingDescription])

  const cancelEditing = () => {
    setIsEditing(false)
    setShowDescriptionInput(false)
    setEditContent(task.content)
    setEditDescription(task.description || "")
    // Clear any optimistic values when canceling
    setOptimisticContent(null)
    setOptimisticDescription(null)
  }

  const saveEditing = async () => {
    const hasContentChanged = editContent !== task.content
    const hasDescriptionChanged = editDescription !== (task.description || "")

    if (!hasContentChanged && !hasDescriptionChanged) {
      setIsEditing(false)
      return
    }

    const updates: Record<string, unknown> = {}
    if (hasContentChanged) updates.content = editContent
    if (hasDescriptionChanged) updates.description = editDescription

    // STEP 1: Set UI-level optimistic values immediately (0ms - instant!)
    if (hasContentChanged) setOptimisticContent(editContent)
    if (hasDescriptionChanged) setOptimisticDescription(editDescription)

    // STEP 2: Exit edit mode - optimistic values will show immediately
    setIsEditing(false)
    setShowDescriptionInput(false)

    // STEP 3: Fire action in background (calls API + syncs to DB on success)
    const result = await updateTask({
      todoistId: task.todoist_id,
      ...updates
    })

    // STEP 4: If action failed, clear optimistic values to show original data
    if (result === null) {
      // Action failed - clear optimistic state so original DB value shows through
      setOptimisticContent(null)
      setOptimisticDescription(null)
    }
    // If success, optimistic values will be cleared when DB updates via Convex reactivity
  }

  // Clear optimistic values when DB value changes (API completed and synced)
  // Since we no longer do DB-level optimistic updates, any DB change means the API call finished
  useEffect(() => {
    if (optimisticContent !== null) {
      setOptimisticContent(null)
    }
    if (optimisticDescription !== null) {
      setOptimisticDescription(null)
    }
  }, [task.content, task.description, optimisticContent, optimisticDescription])

  // Focus content input when entering edit mode
  useEffect(() => {
    if (isEditing && contentInputRef.current) {
      contentInputRef.current.focus()
      contentInputRef.current.select()
    }
  }, [isEditing])

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

  // Use optimistic values if available, otherwise use real DB values
  const displayContent = optimisticContent ?? task.content
  const displayDescription = optimisticDescription ?? task.description
  const markdownSegments = parseMarkdownLinks(displayContent)

  const dueInfo = formatDueDate(task.due)

  return (
    <Card
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      data-task-id={task.todoist_id}
      className={cn(
        "group cursor-pointer transition-all duration-200 hover:shadow-sm",
        "border-transparent hover:border-border",
        "focus:outline-none focus:ring-2 focus:ring-ring"
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-3 text-sm">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleComplete()
                  }}
                  className={cn(
                    "group/checkbox mt-1 flex h-5 w-5 items-center justify-center rounded-full border-[1.75px] border-muted-foreground/40 bg-background transition-colors hover:border-muted-foreground/60",
                    priority?.colorClass && "border-current",
                    priority?.colorClass
                  )}
                  aria-label="Complete task"
                >
                  <Check className="h-3 w-3 opacity-0 transition-opacity group-hover/checkbox:opacity-100" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Complete task
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="flex-1 space-y-1">
        {isEditing ? (
          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={contentInputRef}
              type="text"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void saveEditing()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  cancelEditing()
                } else if (e.key === "Tab") {
                  e.preventDefault()
                  // Show description input when Tab is pressed
                  if (!showDescriptionInput) {
                    setShowDescriptionInput(true)
                    setTimeout(() => {
                      descriptionInputRef.current?.focus()
                    }, 0)
                  } else {
                    descriptionInputRef.current?.focus()
                  }
                }
              }}
              className="w-full -mx-0.5 px-0.5 text-sm font-medium bg-transparent border-none outline-none focus:ring-1 focus:ring-ring focus:rounded"
            />
            {showDescriptionInput && (
              <input
                ref={descriptionInputRef}
                type="text"
                value={editDescription}
                placeholder="Description (optional)"
                onChange={(e) => setEditDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    void saveEditing()
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    cancelEditing()
                  } else if (e.key === "Tab" && e.shiftKey) {
                    e.preventDefault()
                    contentInputRef.current?.focus()
                  }
                }}
                className="w-full -mx-0.5 px-0.5 text-xs text-muted-foreground bg-transparent border-none outline-none focus:ring-1 focus:ring-ring focus:rounded placeholder:text-muted-foreground/50"
              />
            )}
          </div>
        ) : (
          <>
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

            {displayDescription && (
              <p className="text-xs text-muted-foreground">{displayDescription}</p>
            )}
          </>
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
      </CardContent>
    </Card>
  )
})
