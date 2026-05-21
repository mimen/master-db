import { useQuery } from "convex/react"
import { AlertCircle, Calendar, SkipForward, Tag, User } from "lucide-react"
import { memo, useEffect } from "react"

import { BaseListItem } from "./BaseListItem"
import { TaskCompleteCircle } from "./TaskCompleteCircle"

import { PriorityBadge, ProjectBadge, LabelBadge, DateBadge, GhostBadge, AgentStatusBadge, AgentStartGhost } from "@/components/badges/shared"
import { MarkdownLinkText } from "@/components/shared/MarkdownLinkText"
import { Badge } from "@/components/ui/badge"
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
import type { ListQueryInput } from "@/lib/views/types"
import type { TodoistTaskWithProject, TodoistLabelDoc, TodoistProject } from "@/types/convex/todoist"

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
    ? allProjects?.find((p: TodoistProject) => p.todoist_id === optimisticUpdate.newProjectId)
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
      getEntityId={(task: TodoistTaskWithProject) => task.todoist_id}
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
      onSave={async (changes: Record<string, string | undefined>) => {
        await optimisticTaskText(task.todoist_id, changes)
      }}
      renderLeftElement={() => (
        <TaskCompleteCircle
          priorityColorClass={priority?.colorClass}
          isRoutine={isRoutineTask}
          onToggle={(event) => {
            event.stopPropagation()
            void handleComplete()
          }}
          tooltip={isRoutineTask ? "Complete routine task" : "Complete task"}
        />
      )}
      renderPrimaryDisplay={() => <MarkdownLinkText text={displayContent} />}
      renderSecondaryDisplay={() => displayDescription}

      renderFixedBadges={(task: TodoistTaskWithProject, _isHovered: boolean) => (
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

          <AgentStatusBadge entity_ref={`todoist:task:${task.todoist_id}`} />
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
              text="set schedule"
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
              text="set deadline"
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
              text="skip"
              onClick={(e) => {
                e.stopPropagation()
                void handleSkipRoutineTask()
              }}
            />
          )}

          <AgentStartGhost entity_ref={`todoist:task:${task.todoist_id}`} />
        </>
      )}
    />
  )
})
