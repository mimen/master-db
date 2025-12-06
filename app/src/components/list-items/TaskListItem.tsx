import { useQuery } from "convex/react"
import { AlertCircle, Calendar, Check, RefreshCw, SkipForward, Tag, User } from "lucide-react"
import { memo, useEffect } from "react"

import { BaseListItem } from "./BaseListItem"

import { PriorityBadge, ProjectBadge, LabelBadge, DateBadge, GhostBadge } from "@/components/badges/shared"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"
import { useOptimisticSync } from "@/hooks/list-items"
import { useOptimisticDeadlineChange } from "@/hooks/useOptimisticDeadlineChange"
import { useOptimisticDueChange } from "@/hooks/useOptimisticDueChange"
import { useOptimisticLabelChange } from "@/hooks/useOptimisticLabelChange"
import { useOptimisticTaskComplete } from "@/hooks/useOptimisticTaskComplete"
import { useOptimisticTaskText } from "@/hooks/useOptimisticTaskText"
import { useRoutineActions } from "@/hooks/useRoutineActions"
import { getProjectColor } from "@/lib/colors"
import { applyOptimisticTaskUpdate } from "@/lib/cursor/applyOptimisticUpdate"
import { matchesViewFilter } from "@/lib/cursor/filters"
import { formatSmartDate } from "@/lib/dateFormatters"
import { usePriority } from "@/lib/priorities"
import { cn, parseMarkdownLinks } from "@/lib/utils"
import type { ListQueryInput } from "@/lib/views/types"
import type { TodoistTaskWithProject, TodoistLabelDoc } from "@/types/convex/todoist"

interface TaskListItemProps {
  task: TodoistTaskWithProject
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
  allLabels?: TodoistLabelDoc[]
  onEntityRemoved?: (listId: string, entityId: string) => void
  listId?: string
  query: ListQueryInput
}

export const TaskListItem = memo(function TaskListItem({
  task,
  onElementRef,
  onClick,
  allLabels,
  onEntityRemoved,
  listId,
  query
}: TaskListItemProps) {
  // ============= ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS =============

  // Get optimistic update
  const { getTaskUpdate } = useOptimisticUpdates()
  const optimisticUpdate = getTaskUpdate(task.todoist_id)

  // Dialog context
  const { openPriority, openProject, openLabel, openDueDate, openDeadline } = useDialogContext()

  // Optimistic updates
  const { removeTaskUpdate } = useOptimisticUpdates()
  const optimisticLabelChange = useOptimisticLabelChange()
  const optimisticTaskComplete = useOptimisticTaskComplete()
  const optimisticDueChange = useOptimisticDueChange()
  const optimisticDeadlineChange = useOptimisticDeadlineChange()
  const optimisticTaskText = useOptimisticTaskText()

  const allProjects = useQuery(api.todoist.queries.getProjects.getProjects)

  // Display values with optimistic updates
  const displayPriority = optimisticUpdate?.type === "priority-change"
    ? optimisticUpdate.newPriority
    : task.priority
  const priority = usePriority(displayPriority)

  const displayDue = optimisticUpdate?.type === "due-change"
    ? optimisticUpdate.newDue
    : task.due

  const displayDeadline = optimisticUpdate?.type === "deadline-change"
    ? optimisticUpdate.newDeadline
    : task.deadline

  const dueInfo = displayDue
    ? formatSmartDate(displayDue.datetime || displayDue.date)
    : { text: "", isOverdue: false, isToday: false, isTomorrow: false }

  const deadlineInfo = displayDeadline
    ? formatSmartDate(displayDeadline.date)
    : { text: "", isOverdue: false, isToday: false, isTomorrow: false }

  const displayContent = optimisticUpdate?.type === "text-change" && optimisticUpdate.newContent !== undefined
    ? optimisticUpdate.newContent
    : task.content

  const displayDescription = optimisticUpdate?.type === "text-change" && optimisticUpdate.newDescription !== undefined
    ? optimisticUpdate.newDescription
    : task.description

  const displayProject = optimisticUpdate?.type === "project-move"
    ? allProjects?.find(p => p.todoist_id === optimisticUpdate.newProjectId)
    : task.project

  const displayLabels = optimisticUpdate?.type === "label-change"
    ? optimisticUpdate.newLabels
    : task.labels

  // Check if this is a routine task
  const isRoutineTask = displayLabels?.includes("routine")
  const routineTask = useQuery(
    api.routines.queries.getRoutineTaskByTodoistId.getRoutineTaskByTodoistIdPublic,
    isRoutineTask ? { todoistTaskId: task.todoist_id } : "skip"
  )

  // Routine actions
  const { skipRoutineTask } = useRoutineActions()

  const assignee = task.assigned_by_uid || task.responsible_uid
  const markdownSegments = parseMarkdownLinks(displayContent)

  // Notify cursor system when task no longer matches filter (use effect to avoid setState during render)
  useEffect(() => {
    if (!optimisticUpdate || !onEntityRemoved || !listId) return

    const updatedTask = applyOptimisticTaskUpdate(task, optimisticUpdate)
    const stillMatchesFilter = matchesViewFilter(query, updatedTask)

    if (!stillMatchesFilter) {
      onEntityRemoved(listId, task.todoist_id)
    }
  }, [optimisticUpdate, query, task, listId, onEntityRemoved])

  // Expose editing functions to parent (for keyboard shortcuts)
  useEffect(() => {
    const element = document.querySelector(`[data-entity-id="${task.todoist_id}"]`) as HTMLElement & {
      startEditing?: () => void
      startEditingDescription?: () => void
    }
    if (element) {
      // These are exposed by BaseListItem
      // Just verify they exist
      void (element.startEditing || element.startEditingDescription)
    }
  }, [task.todoist_id])

  // Clear optimistic updates when DB syncs
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

  // ============= EARLY RETURNS (after all hooks) =============

  // Hide task immediately if it no longer matches the view's filter
  if (optimisticUpdate) {
    const updatedTask = applyOptimisticTaskUpdate(task, optimisticUpdate)
    if (!matchesViewFilter(query, updatedTask)) {
      return null
    }
  }

  // ============= COMPONENT LOGIC =============

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

  const handleSkipRoutineTask = async () => {
    if (!routineTask?._id) return
    await skipRoutineTask(routineTask._id)
  }

  const getLabelColor = (labelName: string) => {
    const labelObj = allLabels?.find(l => l.name === labelName)
    if (!labelObj) return null
    const color = getProjectColor(labelObj.color)
    return {
      full: color,
      border: `${color}40`,
      background: `${color}15`
    }
  }

  return (
    <BaseListItem
      entity={task}
      entityType="task"
      getEntityId={(task) => task.todoist_id}
      onElementRef={onElementRef}
      onClick={onClick}
      data-task-id={task.todoist_id}
      primaryField={{
        value: displayContent,
        key: 'content'
      }}
      secondaryField={{
        value: displayDescription,
        key: 'description'
      }}
      onSave={async (changes) => {
        await optimisticTaskText(task.todoist_id, changes)
      }}
      renderLeftElement={() => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  void handleComplete()
                }}
                className={cn(
                  "group/checkbox mt-0.5 flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full relative",
                  "transition-colors transition-opacity duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isRoutineTask
                    ? "border-transparent hover:border"
                    : "border ring-1",
                  isRoutineTask && priority?.colorClass === "text-red-500"
                    ? "text-red-500 hover:bg-red-500 hover:border-red-500/60 hover:ring-1 hover:ring-red-500/100"
                    : isRoutineTask && priority?.colorClass === "text-orange-500"
                    ? "text-orange-500 hover:bg-orange-500 hover:border-orange-500/60 hover:ring-1 hover:ring-orange-500/100"
                    : isRoutineTask && priority?.colorClass === "text-blue-500"
                    ? "text-blue-500 hover:bg-blue-500 hover:border-blue-500/60 hover:ring-1 hover:ring-blue-500/100"
                    : isRoutineTask
                    ? "text-foreground/60 hover:bg-foreground/80 hover:border-foreground hover:ring-1 hover:ring-foreground/60"
                    : !isRoutineTask && priority?.colorClass === "text-red-500"
                    ? "text-red-500 border-red-500/60 ring-red-500/100 hover:bg-red-500 hover:ring-red-500/10"
                    : !isRoutineTask && priority?.colorClass === "text-orange-500"
                    ? "text-orange-500 border-orange-500/60 ring-orange-500/100 hover:bg-orange-500 hover:ring-orange-500/10"
                    : !isRoutineTask && priority?.colorClass === "text-blue-500"
                    ? "text-blue-500 border-blue-500/60 ring-blue-500/100 hover:bg-blue-500 hover:ring-blue-500/10"
                    : !isRoutineTask && "border-foreground/20 ring-foreground/60 hover:border-foreground hover:bg-foreground/80 hover:ring-foreground/10"
                )}
                aria-label={isRoutineTask ? "Complete routine task" : "Complete task"}
              >
                {isRoutineTask ? (
                  <>
                    <RefreshCw
                      className="h-[21px] w-[21px] absolute left-1/2 top-1/2 -translate-x-[11px] -translate-y-1/2 transition-opacity duration-150 group-hover/checkbox:opacity-0"
                      strokeWidth={2}
                    />
                    <Check
                      className="h-3 w-3 text-background absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/checkbox:opacity-100"
                      strokeWidth={3}
                    />
                  </>
                ) : (
                  <Check
                    className="h-3 w-3 text-background opacity-0 transition-opacity duration-150 group-hover/checkbox:opacity-100"
                    strokeWidth={3}
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isRoutineTask ? "Complete routine task" : "Complete task"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      renderPrimaryDisplay={() => (
        <>
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
        </>
      )}
      renderSecondaryDisplay={() => displayDescription}
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      renderFixedBadges={(task, isHovered) => (
        <>
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
              {displayLabels
                .filter((label: string) => label !== "routine")
                .map((label: string) => {
                  const labelColor = getLabelColor(label)
                  return (
                    <LabelBadge
                      key={label}
                      label={{
                        name: label,
                        borderColor: labelColor?.border,
                        backgroundColor: labelColor?.background
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
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

          {assignee && (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <User className="h-3 w-3" />
              <span>{assignee}</span>
            </Badge>
          )}
        </>
      )}
      renderHoverBadges={() => (
        <>
          {!priority?.showFlag && (
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

          {!displayDue && (
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

          {!displayDeadline && (
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

          <GhostBadge
            icon={Tag}
            text="add label"
            onClick={(e) => {
              e.stopPropagation()
              onClick?.()
              openLabel(task)
            }}
          />

          {routineTask && routineTask.status === "pending" && (
            <GhostBadge
              icon={SkipForward}
              text="skip routine"
              onClick={(e) => {
                e.stopPropagation()
                void handleSkipRoutineTask()
              }}
            />
          )}
        </>
      )}
    />
  )
})
