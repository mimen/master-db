import { useQuery } from "convex/react"
import { AlertCircle, Calendar, Check, ChevronDown, ChevronRight, Flag, Tag, User, X, RotateCcw } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"
import { useOptimisticDeadlineChange } from "@/hooks/useOptimisticDeadlineChange"
import { useOptimisticDueChange } from "@/hooks/useOptimisticDueChange"
import { useOptimisticLabelChange } from "@/hooks/useOptimisticLabelChange"
import { useOptimisticTaskComplete } from "@/hooks/useOptimisticTaskComplete"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { useTodoistAction } from "@/hooks/useTodoistAction"
import { getProjectColor } from "@/lib/colors"
import { formatSmartDate } from "@/lib/dateFormatters"
import { usePriority } from "@/lib/priorities"
import { cn, parseMarkdownLinks } from "@/lib/utils"
import type { ListInstance, ListQueryInput, ListSupportData } from "@/lib/views/types"
import type {
  TodoistItemsByListWithProjects,
  TodoistLabelDoc,
  TodoistProject,
  TodoistProjects,
  TodoistProjectsWithMetadata,
  TodoistTaskWithProject,
} from "@/types/convex/todoist"

const TASK_ROW_FOCUSED_CLASSNAMES = ["bg-accent/50", "border-primary/30"] as const

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
  const { registry } = useCountRegistry()

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

  const tasks: TodoistItemsByListWithProjects | undefined = useQuery(
    api.todoist.publicQueries.getItemsByViewWithProjects,
    resolvedQuery ? { list: resolvedQuery } : "skip"
  )

  const resolvedTasks = tasks ?? []
  const visibleTasks = list.maxTasks ? resolvedTasks.slice(0, list.maxTasks) : resolvedTasks

  // Get total count from CountRegistry
  const totalCount = registry.getCountForList(list.id, list.query)

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
  // Detect if we're in a project-filtered view (project or inbox)
  const isProjectView = list.query.type === "project" || list.query.type === "inbox"

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
    const taskCountText = totalCount === 0
      ? "Empty"
      : `${totalCount}`

    return (
      <div className="max-w-4xl mx-auto px-6 py-2">
        <div className="flex items-center gap-3 text-sm">
          <div className="text-muted-foreground">{header.icon}</div>
          <span className="flex-1 font-medium text-foreground/70">{header.title}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {taskCountText}
          </Badge>
          {visibleTasks.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onRestore?.(list.id)}
                    className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
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
    <div className={cn(
      "max-w-4xl mx-auto px-6",
      isMultiListView ? "py-4" : "py-0"
    )}>
      {isMultiListView && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-3">
            {list.collapsible && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleExpanded}
                      className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
                      aria-label={isExpanded ? "Collapse list" : "Expand list"}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isExpanded ? "Collapse" : "Expand"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="text-muted-foreground">{header.icon}</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold tracking-tight">{header.title}</h2>
              {header.description && (
                <p className="text-sm text-muted-foreground mt-0.5">{header.description}</p>
              )}
            </div>
            <Badge variant="secondary" className="text-xs font-normal shrink-0">
              {list.maxTasks && visibleTasks.length < totalCount
                ? `Showing ${visibleTasks.length} of ${totalCount}`
                : totalCount}
            </Badge>
            {visibleTasks.length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onDismiss?.(list.id)}
                      className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
                      aria-label="Collapse list"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Collapse list
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <Separator />
        </div>
      )}

      {(isExpanded || !isMultiListView) && (
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
                    isProjectView={isProjectView}
                    allLabels={labels}
                  />
                )
              })}
            </div>
          ) : list.collapsible && isMultiListView ? (
            <div className="py-4 text-sm text-muted-foreground text-center">No tasks</div>
          ) : !isMultiListView ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <p className="text-lg font-semibold mb-1">{emptyState.title}</p>
              {emptyState.description && (
                <p className="text-sm text-muted-foreground max-w-md">{emptyState.description}</p>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

interface TaskRowProps {
  task: TodoistTaskWithProject
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
  isProjectView: boolean // Whether we're in a project-filtered view
  allLabels?: TodoistLabelDoc[] // All labels for color lookup
}

const TaskRow = memo(function TaskRow({ task, onElementRef, onClick, isProjectView, allLabels }: TaskRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [showDescriptionInput, setShowDescriptionInput] = useState(false)
  const [editContent, setEditContent] = useState(task.content)
  const [editDescription, setEditDescription] = useState(task.description || "")
  // UI-level optimistic values - shown while waiting for DB sync
  const [optimisticContent, setOptimisticContent] = useState<string | null>(null)
  const [optimisticDescription, setOptimisticDescription] = useState<string | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const lastSyncedContentRef = useRef(task.content)
  const lastSyncedDescriptionRef = useRef(task.description ?? "")
  const contentInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLInputElement>(null)

  // Centralized optimistic updates
  const { getUpdate, removeUpdate } = useOptimisticUpdates()
  const { openPriority, openProject, openLabel, openDueDate, openDeadline } = useDialogContext()
  const optimisticLabelChange = useOptimisticLabelChange()
  const optimisticTaskComplete = useOptimisticTaskComplete()
  const optimisticDueChange = useOptimisticDueChange()
  const optimisticDeadlineChange = useOptimisticDeadlineChange()

  const updateTask = useTodoistAction(
    api.todoist.publicActions.updateTask,
    {
      loadingMessage: "Updating task...",
      successMessage: "Task updated!",
      errorMessage: "Failed to update task"
    }
  )

  const allProjects: TodoistProject[] | undefined = useQuery(api.todoist.queries.getProjects.getProjects)

  // Check optimistic update from context
  const optimisticUpdate = getUpdate(task.todoist_id)

  // Use optimistic priority if available
  const displayPriority = optimisticUpdate?.type === "priority-change"
    ? optimisticUpdate.newPriority
    : task.priority
  const priority = usePriority(displayPriority)

  // Use optimistic schedule (due date) if available
  const displayDue = optimisticUpdate?.type === "due-change"
    ? optimisticUpdate.newDue
    : task.due

  // Use optimistic deadline if available
  const displayDeadline = optimisticUpdate?.type === "deadline-change"
    ? optimisticUpdate.newDeadline
    : task.deadline

  // Format schedule (due date) for display
  const dueInfo = displayDue
    ? formatSmartDate(displayDue.datetime || displayDue.date)
    : { text: "", isOverdue: false, isToday: false, isTomorrow: false }

  // Format deadline for display
  const deadlineInfo = displayDeadline
    ? formatSmartDate(displayDeadline.date)
    : { text: "", isOverdue: false, isToday: false, isTomorrow: false }

  const handleComplete = async () => {
    await optimisticTaskComplete(task.todoist_id)
  }

  const handleRemoveDue = async () => {
    await optimisticDueChange(task.todoist_id, null)
  }

  const handleRemoveDeadline = async () => {
    await optimisticDeadlineChange(task.todoist_id, null)
  }

  const handleRemoveLabel = async (labelToRemove: string) => {
    const currentLabels = displayLabels || []
    const newLabels = currentLabels.filter((label: string) => label !== labelToRemove)
    await optimisticLabelChange(task.todoist_id, newLabels)
  }

  const getLabelColor = (labelName: string) => {
    const labelObj = allLabels?.find(l => l.name === labelName)
    if (!labelObj) return null
    const color = getProjectColor(labelObj.color) // Reuse getProjectColor since labels use same color scheme
    // Return color variations for different parts of the badge
    return {
      full: color,
      border: `${color}40`, // 25% opacity for subtle border
      background: `${color}15` // 8% opacity for very subtle background tint
    }
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
  useEffect(() => {
    if (task.content !== lastSyncedContentRef.current) {
      lastSyncedContentRef.current = task.content
      setOptimisticContent(null)
    }
  }, [task.content])

  useEffect(() => {
    const normalizedDescription = task.description ?? ""
    if (normalizedDescription !== lastSyncedDescriptionRef.current) {
      lastSyncedDescriptionRef.current = normalizedDescription
      setOptimisticDescription(null)
    }
  }, [task.description])

  // Clear optimistic priority update when DB value syncs
  useEffect(() => {
    if (optimisticUpdate?.type === "priority-change" && task.priority === optimisticUpdate.newPriority) {
      removeUpdate(task.todoist_id)
    }
  }, [task.priority, optimisticUpdate, removeUpdate, task.todoist_id])

  // Clear optimistic project move when DB value syncs
  useEffect(() => {
    if (optimisticUpdate?.type === "project-move" && task.project_id === optimisticUpdate.newProjectId) {
      removeUpdate(task.todoist_id)
    }
  }, [task.project_id, optimisticUpdate, removeUpdate, task.todoist_id])

  // Clear optimistic label change when DB value syncs
  useEffect(() => {
    if (optimisticUpdate?.type === "label-change") {
      const dbLabels = task.labels || []
      const optimisticLabels = optimisticUpdate.newLabels
      // Compare arrays - if they match, DB has synced
      if (
        dbLabels.length === optimisticLabels.length &&
        dbLabels.every((label: string, index: number) => label === optimisticLabels[index])
      ) {
        removeUpdate(task.todoist_id)
      }
    }
  }, [task.labels, optimisticUpdate, removeUpdate, task.todoist_id])

  // Clear optimistic schedule (due date) change when DB value syncs
  useEffect(() => {
    if (optimisticUpdate?.type === "due-change") {
      const dbDue = task.due
      const optimisticDue = optimisticUpdate.newDue

      // Both null - cleared successfully
      if (!dbDue && !optimisticDue) {
        removeUpdate(task.todoist_id)
        return
      }

      // Compare due dates - if they match, DB has synced
      if (dbDue && optimisticDue && dbDue.date === optimisticDue.date) {
        // Also check datetime if present
        const dbDatetime = dbDue.datetime
        const optimisticDatetime = optimisticDue.datetime
        if (dbDatetime === optimisticDatetime) {
          removeUpdate(task.todoist_id)
        }
      }
    }
  }, [task.due, optimisticUpdate, removeUpdate, task.todoist_id])

  // Clear optimistic deadline change when DB value syncs
  useEffect(() => {
    if (optimisticUpdate?.type === "deadline-change") {
      const dbDeadline = task.deadline
      const optimisticDeadline = optimisticUpdate.newDeadline

      // Both null - cleared successfully
      if (!dbDeadline && !optimisticDeadline) {
        removeUpdate(task.todoist_id)
        return
      }

      // Compare deadlines - if they match, DB has synced
      if (dbDeadline && optimisticDeadline && dbDeadline.date === optimisticDeadline.date) {
        removeUpdate(task.todoist_id)
      }
    }
  }, [task.deadline, optimisticUpdate, removeUpdate, task.todoist_id])

  // Focus content input when entering edit mode
  useEffect(() => {
    if (isEditing && contentInputRef.current) {
      contentInputRef.current.focus()
      contentInputRef.current.select()
    }
  }, [isEditing])

  const assignee = task.assigned_by_uid || task.responsible_uid

  // Use optimistic values if available, otherwise use real DB values
  const displayContent = optimisticContent ?? task.content
  const displayDescription = optimisticDescription ?? task.description

  // Check for optimistic project move from context
  const displayProject = optimisticUpdate?.type === "project-move"
    ? allProjects?.find(p => p.todoist_id === optimisticUpdate.newProjectId)
    : task.project

  // Use optimistic labels if available
  const displayLabels = optimisticUpdate?.type === "label-change"
    ? optimisticUpdate.newLabels
    : task.labels

  const markdownSegments = parseMarkdownLinks(displayContent)

  // Hide task immediately if it's being completed
  if (optimisticUpdate?.type === "task-complete") {
    return null
  }

  // Hide task immediately if it's being moved AND we're in a project-filtered view
  if (optimisticUpdate?.type === "project-move" && isProjectView) {
    return null
  }

  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-task-id={task.todoist_id}
      className={cn(
        "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
        "hover:bg-accent/50",
        "focus:outline-none focus:bg-accent/50 focus:border-primary/30"
      )}
    >
        <div className="flex items-start gap-2.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleComplete()
                  }}
                  className={cn(
                    "group/checkbox mt-0.5 flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border transition-all duration-150",
                    "ring-1",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    priority?.colorClass === "text-red-500"
                      ? "text-red-500 border-red-500/60 ring-red-500/100 hover:bg-red-500 hover:ring-red-500/10"
                      : priority?.colorClass === "text-orange-500"
                      ? "text-orange-500 border-orange-500/60 ring-orange-500/100 hover:bg-orange-500 hover:ring-orange-500/10"
                      : priority?.colorClass === "text-blue-500"
                      ? "text-blue-500 border-blue-500/60 ring-blue-500/100 hover:bg-blue-500 hover:ring-blue-500/10"
                      : "border-foreground/20 ring-foreground/60 hover:border-foreground hover:bg-foreground/80 hover:ring-foreground/10"
                  )}
                  aria-label="Complete task"
                >
                  <Check
                    className="h-3 w-3 text-background opacity-0 transition-opacity duration-150 group-hover/checkbox:opacity-100"
                    strokeWidth={3}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Complete task
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div onClick={(e) => e.stopPropagation()}>
            {isEditing ? (
              <>
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
                  className="block w-full bg-transparent px-0 py-0 m-0 text-sm font-medium leading-relaxed text-foreground outline-none border-none break-words"
                  placeholder="Task content"
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
                    className="block w-full bg-transparent px-0 py-0 m-0 mt-1 text-xs leading-relaxed text-muted-foreground outline-none border-none placeholder:text-muted-foreground/70 break-words"
                  />
                )}
              </>
            ) : (
              <>
                <div className="font-medium text-sm leading-relaxed break-words">
                  {markdownSegments.map((segment, index) =>
                    segment.type === "text" ? (
                      <span key={index}>{segment.content}</span>
                    ) : (
                      <a
                        key={index}
                        href={segment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-primary transition-colors"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {segment.content}
                      </a>
                    )
                  )}
                </div>
                {displayDescription && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-words">{displayDescription}</p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {displayProject && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  openProject(task)
                }}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getProjectColor(displayProject.color) }}
                />
                <span>{displayProject.name}</span>
              </Badge>
            )}

            {priority?.showFlag && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
                  priority.colorClass
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  openPriority(task)
                }}
              >
                <Flag className="h-3 w-3" fill="currentColor" />
                <span>{priority.label}</span>
              </Badge>
            )}

            {displayDue && (
              <Badge
                variant={dueInfo.isOverdue ? "destructive" : "outline"}
                className={cn(
                  "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors group/due",
                  dueInfo.isOverdue && "border-red-500 bg-red-50 text-red-700",
                  dueInfo.isToday && !dueInfo.isOverdue && "border-green-500 bg-green-50 text-green-700",
                  (dueInfo.isTomorrow || (!dueInfo.isOverdue && !dueInfo.isToday)) && "border-purple-400 bg-purple-50 text-purple-700"
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  openDueDate(task)
                }}
              >
                <Calendar className={cn(
                  "h-3 w-3 group-hover/due:hidden",
                  dueInfo.isOverdue && "text-red-600",
                  dueInfo.isToday && !dueInfo.isOverdue && "text-green-600",
                  (dueInfo.isTomorrow || (!dueInfo.isOverdue && !dueInfo.isToday)) && "text-purple-600"
                )} />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleRemoveDue()
                  }}
                  className="hidden group-hover/due:block hover:text-destructive transition-colors"
                  aria-label="Remove schedule"
                >
                  <X className="h-3 w-3" />
                </button>
                <span>{dueInfo.text}</span>
              </Badge>
            )}

            {displayDeadline && (() => {
              // Calculate if deadline is within 3 days
              const deadlineDate = displayDeadline ? new Date(displayDeadline.date + 'T00:00:00') : null
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              const daysUntil = deadlineDate ? Math.floor((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : 999
              const isWithin3Days = daysUntil >= 0 && daysUntil <= 2 && !deadlineInfo.isToday
              const isFuture = daysUntil > 2

              return (
                <Badge
                  variant={deadlineInfo.isOverdue || deadlineInfo.isToday ? "destructive" : "outline"}
                  className={cn(
                    "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors group/deadline",
                    (deadlineInfo.isOverdue || deadlineInfo.isToday) && "border-red-500 bg-red-50 text-red-700",
                    isWithin3Days && "border-orange-500 bg-orange-50 text-orange-700",
                    isFuture && "border-gray-300 bg-gray-50 text-gray-700"
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    openDeadline(task)
                  }}
                >
                  <AlertCircle className={cn(
                    "h-3 w-3 group-hover/deadline:hidden text-red-600"
                  )} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleRemoveDeadline()
                    }}
                    className="hidden group-hover/deadline:block hover:text-destructive transition-colors"
                    aria-label="Remove deadline"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <span>{deadlineInfo.text}</span>
                </Badge>
              )
            })()}

            {displayLabels && displayLabels.length > 0 && (
              <>
                {displayLabels.map((label: string) => {
                  const labelColor = getLabelColor(label)
                  return (
                    <Badge
                      key={label}
                      variant="secondary"
                      className="gap-1.5 font-normal group/label border"
                      style={labelColor ? {
                        borderColor: labelColor.border,
                        backgroundColor: labelColor.background
                      } : undefined}
                    >
                      <Tag
                        className="h-3 w-3 group-hover/label:hidden"
                        style={labelColor ? { color: labelColor.full } : undefined}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRemoveLabel(label)
                        }}
                        className="hidden group-hover/label:block hover:text-destructive transition-colors"
                        aria-label={`Remove ${label} label`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <span>{label}</span>
                    </Badge>
                  )
                })}
              </>
            )}

            {task.assigned_by_uid && (
              <Badge variant="outline" className="gap-1.5 font-normal">
                <User className="h-3 w-3" />
                <span>{assignee}</span>
              </Badge>
            )}

            {isHovered && !priority?.showFlag && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  openPriority(task)
                }}
              >
                <Flag className="h-3 w-3" />
                <span>P4</span>
              </Badge>
            )}

            {isHovered && !displayDue && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  openDueDate(task)
                }}
              >
                <Calendar className="h-3 w-3" />
                <span>add schedule</span>
              </Badge>
            )}

            {isHovered && !displayDeadline && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  openDeadline(task)
                }}
              >
                <AlertCircle className="h-3 w-3" />
                <span>add deadline</span>
              </Badge>
            )}

            {isHovered && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  openLabel(task)
                }}
              >
                <Tag className="h-3 w-3" />
                <span>add label</span>
              </Badge>
            )}
          </div>
        </div>
        </div>
    </div>
  )
})
