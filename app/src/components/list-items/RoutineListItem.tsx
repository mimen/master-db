import { useQuery } from "convex/react"
import { Folder, Pause, Play, Repeat, Tag } from "lucide-react"
import { memo } from "react"

import { DetailsBadge, EditBadge } from "@/components/badges/routine-specific"
import { PriorityBadge, ProjectBadge, LabelBadge, GhostBadge, TimeOfDayBadge, IdealDayBadge, DurationBadge } from "@/components/badges/shared"
import { Badge } from "@/components/ui/badge"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { useOptimisticRoutineName } from "@/hooks/useOptimisticRoutineName"
import { useOptimisticRoutineDescription } from "@/hooks/useOptimisticRoutineDescription"
import { useOptimisticSync } from "@/hooks/list-items"
import { useRoutineActions } from "@/hooks/useRoutineActions"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { BaseListItem } from "./BaseListItem"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface RoutineListItemProps {
  routine: Doc<"routines">
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
  onOpenDetail?: (routine: Doc<"routines">) => void
  onOpenEdit?: (routine: Doc<"routines">) => void
}

function getFrequencyColor(frequency: string): string {
  if (frequency === "Daily" || frequency === "Twice a Week") {
    return "text-green-600 dark:text-green-400"
  }
  if (frequency === "Weekly" || frequency === "Every Other Week") {
    return "text-blue-600 dark:text-blue-400"
  }
  return "text-purple-600 dark:text-purple-400"
}

function getCompletionRateColor(rate: number): string {
  if (rate >= 80) return "text-green-600 dark:text-green-400"
  if (rate >= 50) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

export const RoutineListItem = memo(function RoutineListItem({
  routine,
  onElementRef,
  onClick,
  onOpenDetail,
  onOpenEdit
}: RoutineListItemProps) {
  const { openPriority, openProject, openLabel } = useDialogContext()
  const { getRoutineUpdate, removeRoutineUpdate } = useOptimisticUpdates()
  const { deferRoutine, undeferRoutine } = useRoutineActions()

  const optimisticUpdate = getRoutineUpdate(routine._id)
  const updateRoutineName = useOptimisticRoutineName()
  const updateRoutineDescription = useOptimisticRoutineDescription()

  const projects = useQuery(api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata, {})

  const handleTogglePause = async (e: React.MouseEvent) => {
    e.stopPropagation()
    onClick?.()
    if (routine.defer) {
      await undeferRoutine(routine._id)
    } else {
      await deferRoutine(routine._id)
    }
  }

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
  const displayLabels = effectiveLabels.filter((l: string) => l !== "routine")
  const frequencyColor = getFrequencyColor(routine.frequency)
  const completionRateColor = getCompletionRateColor(routine.completionRateOverall)

  // Clear optimistic updates when DB syncs
  useOptimisticSync({
    entity: routine,
    optimisticUpdate,
    shouldClear: (r, update) => {
      if (update.type === "text-change") {
        if (update.newName !== undefined && update.newName === r.name) {
          return true
        }
        if (update.newDescription !== undefined && update.newDescription === (r.description ?? "")) {
          return true
        }
      } else if (update.type === "priority-change") {
        if (update.newPriority === r.priority) {
          return true
        }
      } else if (update.type === "project-change") {
        if (update.newProjectId === r.todoistProjectId) {
          return true
        }
      } else if (update.type === "label-change") {
        if (JSON.stringify(r.todoistLabels.sort()) === JSON.stringify(update.newLabels.sort())) {
          return true
        }
      }
      return false
    },
    onClear: () => removeRoutineUpdate(routine._id)
  })

  return (
    <BaseListItem
      entity={routine}
      entityType="routine"
      getEntityId={(r) => r._id}
      onElementRef={onElementRef}
      onClick={onClick}
      archivedClass={routine.defer ? "opacity-60" : undefined}
      data-routine-id={routine._id}
      primaryField={{
        value: effectiveName,
        key: 'name'
      }}
      secondaryField={{
        value: effectiveDescription,
        key: 'description'
      }}
      onSave={async (changes) => {
        if (changes.name) {
          await updateRoutineName(routine._id, changes.name)
        }
        if (changes.description !== undefined) {
          await updateRoutineDescription(routine._id, changes.description)
        }
      }}
      renderLeftElement={() => (
        <Repeat className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
      )}
      renderPrimaryDisplay={() => effectiveName}
      renderSecondaryDisplay={() => effectiveDescription}
      renderFixedBadges={(r, isHovered) => (
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
                openProject(r)
              }}
            />
          )}

          <Badge
            variant="outline"
            className={`text-xs font-normal cursor-pointer hover:bg-accent/80 transition-colors ${frequencyColor}`}
            onClick={(e) => {
              e.stopPropagation()
              onClick?.()
              onOpenEdit?.(r)
            }}
          >
            {routine.frequency}
          </Badge>

          {routine.timeOfDay && (
            <TimeOfDayBadge
              timeOfDay={routine.timeOfDay}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenEdit?.(r)
              }}
            />
          )}

          {routine.idealDay !== undefined && (
            <IdealDayBadge
              day={routine.idealDay}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenEdit?.(r)
              }}
            />
          )}

          {routine.duration && (
            <DurationBadge
              duration={routine.duration}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenEdit?.(r)
              }}
            />
          )}

          {priority?.showFlag && (
            <PriorityBadge
              priority={priority}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openPriority(r)
              }}
            />
          )}

          {displayLabels.map((label: string) => (
            <LabelBadge
              key={label}
              label={{ name: label }}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openLabel(r)
              }}
            />
          ))}

          <DetailsBadge
            completionRate={routine.completionRateOverall}
            colorClass={completionRateColor}
            onClick={(e) => {
              e.stopPropagation()
              onClick?.()
              onOpenDetail?.(r)
            }}
          />

          <Badge
            variant="outline"
            className={`gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors ${
              routine.defer ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
            }`}
            onClick={handleTogglePause}
          >
            {routine.defer ? (
              <>
                <Play className="h-3 w-3" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" />
                <span>Pause</span>
              </>
            )}
          </Badge>
        </>
      )}
      renderHoverBadges={(r) => (
        <>
          {!priority?.showFlag && (
            <PriorityBadge
              priority={{ label: "P4", colorClass: "" }}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openPriority(r)
              }}
              isGhost
            />
          )}

          {!displayProject && (
            <GhostBadge
              icon={Folder}
              text="Set project"
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openProject(r)
              }}
            />
          )}

          {displayLabels.length === 0 && (
            <GhostBadge
              icon={Tag}
              text="Add label"
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openLabel(r)
              }}
            />
          )}

          {routine.frequency === "Daily" && !routine.timeOfDay && (
            <TimeOfDayBadge
              timeOfDay="Set time"
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenEdit?.(r)
              }}
              isGhost
            />
          )}

          {(routine.frequency === "Weekly" || routine.frequency === "Every Other Week") &&
           routine.idealDay === undefined && (
            <IdealDayBadge
              day={1}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                onOpenEdit?.(r)
              }}
              isGhost
            />
          )}

          <EditBadge
            onClick={(e) => {
              e.stopPropagation()
              onClick?.()
              onOpenEdit?.(r)
            }}
          />
        </>
      )}
    />
  )
})
