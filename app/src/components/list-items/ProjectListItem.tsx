import { Archive, ArchiveRestore } from "lucide-react"
import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import { PriorityBadge, ProjectTypeBadge } from "@/components/badges/shared"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { useOptimisticProjectDescription } from "@/hooks/useOptimisticProjectDescription"
import { useOptimisticProjectName } from "@/hooks/useOptimisticProjectName"
import { useOptimisticSync } from "@/hooks/list-items"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { BaseListItem } from "./BaseListItem"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectListItemProps {
  project: TodoistProjectWithMetadata
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
  onUnarchive?: (projectId: string) => void
}

export const ProjectListItem = memo(function ProjectListItem({
  project,
  onElementRef,
  onClick,
  onUnarchive
}: ProjectListItemProps) {
  const { openPriority, openArchive, openProjectType } = useDialogContext()
  const { getProjectUpdate, removeProjectUpdate } = useOptimisticUpdates()

  const updateProjectName = useOptimisticProjectName()
  const updateProjectDescription = useOptimisticProjectDescription()

  const optimisticUpdate = getProjectUpdate(project.todoist_id)

  const displayName = optimisticUpdate?.type === "text-change" && optimisticUpdate.newName !== undefined
    ? optimisticUpdate.newName
    : project.name

  const displayDescription = optimisticUpdate?.type === "text-change" && optimisticUpdate.newDescription !== undefined
    ? optimisticUpdate.newDescription
    : project.metadata?.description

  const displayPriority = optimisticUpdate?.type === "priority-change"
    ? optimisticUpdate.newPriority
    : project.metadata?.priority

  const priority = usePriority(displayPriority)
  const activeCount = project.stats.activeCount
  const displayProjectType = project.metadata?.projectType

  // Clear optimistic updates when DB syncs
  useOptimisticSync({
    entity: project,
    optimisticUpdate,
    shouldClear: (proj, update) => {
      if (update.type === "text-change") {
        if (update.newName !== undefined && update.newName === proj.name) {
          return true
        }
        if (update.newDescription !== undefined && update.newDescription === (proj.metadata?.description ?? "")) {
          return true
        }
      } else if (update.type === "priority-change") {
        if (update.newPriority === proj.metadata?.priority) {
          return true
        }
      }
      return false
    },
    onClear: () => removeProjectUpdate(project.todoist_id)
  })

  const handleArchive = () => {
    openArchive(project)
  }

  return (
    <BaseListItem
      entity={project}
      entityType="project"
      getEntityId={(proj) => proj.todoist_id}
      onElementRef={onElementRef}
      onClick={onClick}
      data-project-id={project.todoist_id}
      archivedClass={project.is_archived ? "opacity-60" : undefined}
      primaryField={{
        value: displayName,
        key: 'name'
      }}
      secondaryField={{
        value: displayDescription,
        key: 'description'
      }}
      onSave={async (changes) => {
        if (changes.name) {
          await updateProjectName(project.todoist_id, changes.name)
        }
        if (changes.description !== undefined) {
          await updateProjectDescription(project.todoist_id, changes.description)
        }
      }}
      renderLeftElement={() => (
        <div
          className="w-4 h-4 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />
      )}
      renderPrimaryDisplay={() => displayName}
      renderSecondaryDisplay={() => displayDescription}
      renderFixedBadges={(proj, isHovered) => (
        <>
          {(priority?.showFlag || isHovered) && (
            <PriorityBadge
              priority={priority || { label: "P4", colorClass: null }}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openPriority(proj)
              }}
              isGhost={!priority?.showFlag}
            />
          )}

          {(displayProjectType || isHovered) && (
            <ProjectTypeBadge
              projectType={displayProjectType}
              onClick={(e) => {
                e.stopPropagation()
                onClick?.()
                openProjectType(proj)
              }}
              isGhost={!displayProjectType}
            />
          )}

          {activeCount > 0 && (
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <span className="text-xs">{activeCount} task{activeCount !== 1 ? 's' : ''}</span>
            </Badge>
          )}

          {isHovered && (
            proj.is_archived ? (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  onUnarchive?.(proj.todoist_id)
                }}
              >
                <ArchiveRestore className="h-3 w-3" />
                <span>Unarchive</span>
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  handleArchive()
                }}
              >
                <Archive className="h-3 w-3" />
                <span>Archive</span>
              </Badge>
            )
          )}
        </>
      )}
    />
  )
})
