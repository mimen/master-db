import { useQuery } from "convex/react"
import { AlertCircle, Calendar, Check, Flag, Tag, User, X, RotateCcw } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { PriorityBadge, ProjectBadge, LabelBadge, DateBadge, GhostBadge } from "@/components/badges/shared"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
import { useFocusContext } from "@/contexts/FocusContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"
import { useOptimisticDeadlineChange } from "@/hooks/useOptimisticDeadlineChange"
import { useOptimisticDueChange } from "@/hooks/useOptimisticDueChange"
import { useOptimisticLabelChange } from "@/hooks/useOptimisticLabelChange"
import { useOptimisticTaskComplete } from "@/hooks/useOptimisticTaskComplete"
import { useOptimisticTaskText } from "@/hooks/useOptimisticTaskText"
import { useTaskDialogShortcuts } from "@/hooks/useTaskDialogShortcuts"
import { useListItemFocus, useListItemHover, useListItemEditing, useOptimisticSync } from "@/hooks/list-items"
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
  const { setFocusedTask } = useFocusContext()

  const projects: TodoistProjects | undefined = useQuery(
    api.todoist.queries.getProjects.getProjects,
    list.dependencies.projects ? {} : "skip"
  )

  const projectsWithMetadata: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata,
    list.dependencies.projectMetadata ? {} : "skip"
  )

  const labels: TodoistLabelDoc[] | undefined = useQuery(
    api.todoist.queries.getLabels.getLabels,
    list.dependencies.labels ? {} : "skip"
  )

  const taskRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])

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
    api.todoist.queries.getItemsByViewWithProjects.getItemsByViewWithProjects,
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

  // Update global focus context when focused task changes
  useEffect(() => {
    setFocusedTask(focusedTask)
  }, [focusedTask, setFocusedTask])

  useTaskDialogShortcuts(focusedTask)

  useEffect(() => {
    onTaskCountChange?.(list.id, visibleTasks.length)
  }, [list.id, onTaskCountChange, visibleTasks.length])

  useEffect(() => {
    setIsExpanded(list.startExpanded)
  }, [list.id, list.startExpanded])

  // Focus management using shared hook
  useListItemFocus({
    entityType: 'task',
    focusedIndex: focusedTaskIndex,
    entitiesLength: visibleTasks.length,
    elementRefs: taskRefs,
    onExpand: () => setIsExpanded(true)
  })

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
  // Hover state using shared hook
  const { isHovered, onMouseEnter, onMouseLeave } = useListItemHover()

  // Centralized optimistic updates
  const { getTaskUpdate, removeTaskUpdate } = useOptimisticUpdates()
  const { openPriority, openProject, openLabel, openDueDate, openDeadline } = useDialogContext()
  const optimisticLabelChange = useOptimisticLabelChange()
  const optimisticTaskComplete = useOptimisticTaskComplete()
  const optimisticDueChange = useOptimisticDueChange()
  const optimisticDeadlineChange = useOptimisticDeadlineChange()
  const optimisticTaskText = useOptimisticTaskText()

  // Editing state using shared hook
  const editing = useListItemEditing({
    entity: task,
    entityId: task.todoist_id,
    fields: {
      primary: { value: task.content, key: 'content' },
      secondary: { value: task.description, key: 'description' }
    },
    onSave: async (changes) => {
      await optimisticTaskText(task.todoist_id, changes)
    }
  })

  const allProjects: TodoistProject[] | undefined = useQuery(api.todoist.queries.getProjects.getProjects)

  // Check optimistic update from context
  const optimisticUpdate = getTaskUpdate(task.todoist_id)

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

  // Clear optimistic updates when DB syncs using shared hook
  useOptimisticSync({
    entity: task,
    optimisticUpdate,
    shouldClear: (task, update) =>
      update.type === 'text-change' &&
      ((update.newContent !== undefined && update.newContent === task.content) ||
       (update.newDescription !== undefined && update.newDescription === (task.description ?? ''))),
    onClear: () => removeTaskUpdate(task.todoist_id)
  })

  useOptimisticSync({
    entity: task,
    optimisticUpdate,
    shouldClear: (task, update) =>
      update.type === 'priority-change' && task.priority === update.newPriority,
    onClear: () => removeTaskUpdate(task.todoist_id)
  })

  useOptimisticSync({
    entity: task,
    optimisticUpdate,
    shouldClear: (task, update) =>
      update.type === 'project-move' && task.project_id === update.newProjectId,
    onClear: () => removeTaskUpdate(task.todoist_id)
  })

  useOptimisticSync({
    entity: task,
    optimisticUpdate,
    shouldClear: (task, update) =>
      update.type === 'label-change' &&
      task.labels?.length === update.newLabels.length &&
      task.labels.every((label: string, index: number) => label === update.newLabels[index]),
    onClear: () => removeTaskUpdate(task.todoist_id)
  })

  useOptimisticSync({
    entity: task,
    optimisticUpdate,
    shouldClear: (task, update) => {
      if (update.type !== 'due-change') return false
      const dbDue = task.due
      const optimisticDue = update.newDue
      if (!dbDue && !optimisticDue) return true
      return dbDue && optimisticDue && dbDue.date === optimisticDue.date && dbDue.datetime === optimisticDue.datetime
    },
    onClear: () => removeTaskUpdate(task.todoist_id)
  })

  useOptimisticSync({
    entity: task,
    optimisticUpdate,
    shouldClear: (task, update) => {
      if (update.type !== 'deadline-change') return false
      const dbDeadline = task.deadline
      const optimisticDeadline = update.newDeadline
      if (!dbDeadline && !optimisticDeadline) return true
      return dbDeadline && optimisticDeadline && dbDeadline.date === optimisticDeadline.date
    },
    onClear: () => removeTaskUpdate(task.todoist_id)
  })

  const assignee = task.assigned_by_uid || task.responsible_uid

  // Use optimistic values if available, otherwise use real DB values
  const displayContent =
    optimisticUpdate?.type === "text-change" && optimisticUpdate.newContent !== undefined
      ? optimisticUpdate.newContent
      : task.content
  const displayDescription =
    optimisticUpdate?.type === "text-change" && optimisticUpdate.newDescription !== undefined
      ? optimisticUpdate.newDescription
      : task.description

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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-task-id={task.todoist_id}
      data-entity-id={task.todoist_id}
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
            {editing.isEditing ? (
              <>
                <input
                  ref={editing.primaryInputRef}
                  type="text"
                  value={editing.primaryValue}
                  onChange={(e) => editing.setPrimaryValue(e.target.value)}
                  onKeyDown={editing.handlePrimaryKeyDown}
                  className="block w-full bg-transparent px-0 py-0 m-0 text-sm font-medium leading-relaxed text-foreground outline-none border-none break-words"
                  placeholder="Task content"
                />
                {editing.showSecondaryInput && (
                  <input
                    ref={editing.secondaryInputRef}
                    type="text"
                    value={editing.secondaryValue}
                    placeholder="Description (optional)"
                    onChange={(e) => editing.setSecondaryValue(e.target.value)}
                    onKeyDown={editing.handleSecondaryKeyDown}
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
              <ProjectBadge
                project={{
                  name: displayProject.name,
                  color: getProjectColor(displayProject.color)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openProject(task)
                }}
              />
            )}

            {priority?.showFlag && (
              <PriorityBadge
                priority={priority}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openPriority(task)
                }}
              />
            )}

            {displayDue && (
              <DateBadge
                date={dueInfo.text}
                status={
                  dueInfo.isOverdue ? "overdue" :
                  dueInfo.isToday ? "today" :
                  dueInfo.isTomorrow ? "tomorrow" :
                  "future"
                }
                icon={Calendar}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openDueDate(task)
                }}
                onRemove={(e) => {
                  e.stopPropagation()
                  void handleRemoveDue()
                }}
              />
            )}

            {displayDeadline && (
              <DateBadge
                date={deadlineInfo.text}
                status={
                  deadlineInfo.isOverdue ? "overdue" :
                  deadlineInfo.isToday ? "today" :
                  "future"
                }
                icon={AlertCircle}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openDeadline(task)
                }}
                onRemove={(e) => {
                  e.stopPropagation()
                  void handleRemoveDeadline()
                }}
              />
            )}

            {displayLabels && displayLabels.length > 0 && (
              <>
                {displayLabels.map((label: string) => {
                  const labelColor = getLabelColor(label)
                  return (
                    <LabelBadge
                      key={label}
                      label={{
                        name: label,
                        color: labelColor?.border
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        // Labels are currently only removable, not editable
                        // Future: could open labels dialog for editing
                      }}
                      onRemove={(e) => {
                        e.stopPropagation()
                        void handleRemoveLabel(label)
                      }}
                    />
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
              <PriorityBadge
                priority={{ label: "P4", colorClass: null }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openPriority(task)
                }}
                isGhost={true}
              />
            )}

            {isHovered && !displayDue && (
              <GhostBadge
                icon={Calendar}
                text="add schedule"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openDueDate(task)
                }}
              />
            )}

            {isHovered && !displayDeadline && (
              <GhostBadge
                icon={AlertCircle}
                text="add deadline"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openDeadline(task)
                }}
              />
            )}

            {isHovered && (
              <GhostBadge
                icon={Tag}
                text="add label"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openLabel(task)
                }}
              />
            )}
          </div>
        </div>
        </div>
    </div>
  )
})
