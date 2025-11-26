import { useQuery } from "convex/react"
import { Folder, Repeat, Tag } from "lucide-react"
import { memo, useEffect } from "react"

import { DetailsBadge, EditBadge } from "@/components/badges/routine-specific"
import { PriorityBadge, ProjectBadge, LabelBadge, GhostBadge, TimeOfDayBadge, IdealDayBadge, DurationBadge } from "@/components/badges/shared"
import { Badge } from "@/components/ui/badge"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { useOptimisticRoutineName } from "@/hooks/useOptimisticRoutineName"
import { useOptimisticRoutineDescription } from "@/hooks/useOptimisticRoutineDescription"
import { useListItemHover, useListItemEditing, useOptimisticSync } from "@/hooks/list-items"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface RoutineRowProps {
  routine: Doc<"routines">
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
  onOpenDetail?: (routine: Doc<"routines">) => void
  onOpenEdit?: (routine: Doc<"routines">) => void
}

// Helper to get frequency display color
function getFrequencyColor(frequency: string): string {
  if (frequency === "Daily" || frequency === "Twice a Week") {
    return "text-green-600 dark:text-green-400"
  }
  if (frequency === "Weekly" || frequency === "Every Other Week") {
    return "text-blue-600 dark:text-blue-400"
  }
  return "text-purple-600 dark:text-purple-400"
}

// Helper to get completion rate color
function getCompletionRateColor(rate: number): string {
  if (rate >= 80) return "text-green-600 dark:text-green-400"
  if (rate >= 50) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

export const RoutineRow = memo(function RoutineRow({ routine, onElementRef, onClick, onOpenDetail, onOpenEdit }: RoutineRowProps) {
  const frequencyColor = getFrequencyColor(routine.frequency)
  const completionRateColor = getCompletionRateColor(routine.completionRateOverall)

  // Dialog context
  const { openPriority, openProject, openLabel } = useDialogContext()

  // Optimistic updates
  const { getRoutineUpdate, removeRoutineUpdate } = useOptimisticUpdates()
  const optimisticUpdate = getRoutineUpdate(routine._id)

  const updateRoutineName = useOptimisticRoutineName()
  const updateRoutineDescription = useOptimisticRoutineDescription()

  // Use shared hover state hook
  const { isHovered, onMouseEnter, onMouseLeave } = useListItemHover()

  // Use shared inline editing hook
  const editing = useListItemEditing({
    entity: routine,
    entityId: routine._id,
    fields: {
      primary: { value: routine.name, key: 'name' },
      secondary: { value: routine.description, key: 'description' }
    },
    onSave: async (changes) => {
      if (changes.name) {
        await updateRoutineName(routine._id, changes.name)
      }
      if (changes.description !== undefined) {
        await updateRoutineDescription(routine._id, changes.description)
      }
    }
  })

  // Expose editing functions to parent (for keyboard shortcuts)
  useEffect(() => {
    const element = document.querySelector(`[data-routine-id="${routine._id}"]`) as HTMLElement & {
      startEditing?: () => void
      startEditingDescription?: () => void
    }
    if (element) {
      element.startEditing = editing.startEditing
      element.startEditingDescription = editing.startEditingSecondary
    }
  }, [routine._id, editing.startEditing, editing.startEditingSecondary])

  // Get projects for display
  const projects = useQuery(api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata, {})

  // Calculate effective values (merge optimistic updates with routine data)
  const effectiveName = optimisticUpdate?.type === "text-change" && optimisticUpdate.newName !== undefined
    ? optimisticUpdate.newName
    : routine.name

  const effectiveDescription = optimisticUpdate?.type === "text-change" && optimisticUpdate.newDescription !== undefined
    ? optimisticUpdate.newDescription
    : routine.description

  const effectivePriority = optimisticUpdate?.type === "priority-change"
    ? optimisticUpdate.newPriority
    : routine.priority

  const effectiveProjectId = optimisticUpdate?.type === "project-change"
    ? optimisticUpdate.newProjectId
    : routine.todoistProjectId

  const effectiveLabels = optimisticUpdate?.type === "label-change"
    ? optimisticUpdate.newLabels
    : routine.todoistLabels

  // Get display data
  const priority = usePriority(effectivePriority)
  const displayProject = projects?.find((p: TodoistProjectWithMetadata) => p.todoist_id === effectiveProjectId)
  // Filter out "routine" label (auto-applied to generated tasks)
  const displayLabels = effectiveLabels.filter((l: string) => l !== "routine")

  // Clear optimistic updates when DB syncs (using shared hook)
  useOptimisticSync({
    entity: routine,
    optimisticUpdate,
    shouldClear: (r, update) => {
      if (update.type === "text-change") {
        // Name update completed
        if (update.newName !== undefined && update.newName === r.name) {
          return true
        }
        // Description update completed
        if (update.newDescription !== undefined && update.newDescription === (r.description ?? "")) {
          return true
        }
      } else if (update.type === "priority-change") {
        // Priority update completed
        if (update.newPriority === r.priority) {
          return true
        }
      } else if (update.type === "project-change") {
        // Project update completed
        if (update.newProjectId === r.todoistProjectId) {
          return true
        }
      } else if (update.type === "label-change") {
        // Label update completed
        if (JSON.stringify(r.todoistLabels.sort()) === JSON.stringify(update.newLabels.sort())) {
          return true
        }
      }
      return false
    },
    onClear: () => removeRoutineUpdate(routine._id)
  })

  return (
    <div
      ref={onElementRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      tabIndex={-1}
      aria-selected={false}
      data-routine-id={routine._id}
      data-entity-id={routine._id}
      className={cn(
        "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
        "hover:bg-accent/50",
        "focus:outline-none focus:bg-accent/50 focus:border-primary/30",
        routine.defer && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2.5 w-full">
        {/* Routine Icon */}
        <Repeat className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Content/Editing Area */}
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
                  placeholder="Routine name"
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
                <div className="font-medium truncate">{effectiveName}</div>
                {effectiveDescription && (
                  <div className="text-sm text-muted-foreground truncate">
                    {effectiveDescription}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Badge Container */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Project Badge */}
            {displayProject && (
              <ProjectBadge
                project={{
                  name: displayProject.name,
                  color: getProjectColor(displayProject.color)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openProject(routine)
                }}
              />
            )}

            {/* Frequency Badge */}
            <Badge
              variant="outline"
              className={cn("text-xs font-normal cursor-pointer hover:bg-accent/80 transition-colors", frequencyColor)}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenEdit?.(routine)
              }}
            >
              {routine.frequency}
            </Badge>

            {/* Time of Day Badge */}
            {routine.timeOfDay && (
              <TimeOfDayBadge
                timeOfDay={routine.timeOfDay}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onOpenEdit?.(routine)
                }}
              />
            )}

            {/* Ideal Day Badge */}
            {routine.idealDay !== undefined && (
              <IdealDayBadge
                day={routine.idealDay}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onOpenEdit?.(routine)
                }}
              />
            )}

            {/* Duration Badge */}
            {routine.duration && (
              <DurationBadge
                duration={routine.duration}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onOpenEdit?.(routine)
                }}
              />
            )}

            {/* Priority Badge */}
            {priority?.showFlag && (
              <PriorityBadge
                priority={priority}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openPriority(routine)
                }}
              />
            )}

            {/* Label Badges */}
            {displayLabels.map((label: string) => (
              <LabelBadge
                key={label}
                label={{ name: label }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openLabel(routine)
                }}
              />
            ))}

            {/* Details Badge (Completion Rate) - Stats */}
            <DetailsBadge
              completionRate={routine.completionRateOverall}
              colorClass={completionRateColor}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenDetail?.(routine)
              }}
            />

            {/* Ghost Badges (on hover) - Always at the end */}
            {isHovered && !priority?.showFlag && (
              <PriorityBadge
                priority={{ label: "P4", colorClass: "" }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openPriority(routine)
                }}
                isGhost
              />
            )}

            {isHovered && !displayProject && (
              <GhostBadge
                icon={Folder}
                text="Set project"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openProject(routine)
                }}
              />
            )}

            {isHovered && displayLabels.length === 0 && (
              <GhostBadge
                icon={Tag}
                text="Add label"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openLabel(routine)
                }}
              />
            )}

            {/* Ghost Time of Day - only for Daily routines without timeOfDay set */}
            {isHovered && routine.frequency === "Daily" && !routine.timeOfDay && (
              <TimeOfDayBadge
                timeOfDay="Set time"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onOpenEdit?.(routine)
                }}
                isGhost
              />
            )}

            {/* Ghost Ideal Day - only for Weekly/Every Other Week routines without idealDay set */}
            {isHovered &&
             (routine.frequency === "Weekly" || routine.frequency === "Every Other Week") &&
             routine.idealDay === undefined && (
              <IdealDayBadge
                day={1} // Monday as default display
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onOpenEdit?.(routine)
                }}
                isGhost
              />
            )}

            {/* Edit ghost badge - always show on hover */}
            {isHovered && (
              <EditBadge
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onOpenEdit?.(routine)
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
