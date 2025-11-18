import { Archive, ArchiveRestore } from "lucide-react"
import { memo, useEffect } from "react"

import { Badge } from "@/components/ui/badge"
import { PriorityBadge } from "@/components/badges/shared"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { useOptimisticProjectDescription } from "@/hooks/useOptimisticProjectDescription"
import { useOptimisticProjectName } from "@/hooks/useOptimisticProjectName"
import { useListItemHover, useListItemEditing, useOptimisticSync } from "@/hooks/list-items"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { getProjectTypeIcon } from "@/lib/projectTypes"
import { cn } from "@/lib/utils"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectRowProps {
  project: TodoistProjectWithMetadata
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
  onUnarchive?: (projectId: string) => void
}

export const ProjectRow = memo(function ProjectRow({ project, onElementRef, onClick, onUnarchive }: ProjectRowProps) {
  const { openPriority, openArchive } = useDialogContext()
  const { getProjectUpdate, removeProjectUpdate } = useOptimisticUpdates()

  const updateProjectName = useOptimisticProjectName()
  const updateProjectDescription = useOptimisticProjectDescription()

  // Use shared hover state hook
  const { isHovered, onMouseEnter, onMouseLeave } = useListItemHover()

  // Use shared inline editing hook
  const editing = useListItemEditing({
    entity: project,
    entityId: project.todoist_id,
    fields: {
      primary: { value: project.name, key: 'name' },
      secondary: { value: project.metadata?.description, key: 'description' }
    },
    onSave: async (changes) => {
      if (changes.name) {
        await updateProjectName(project.todoist_id, changes.name)
      }
      if (changes.description !== undefined) {
        await updateProjectDescription(project.todoist_id, changes.description)
      }
    }
  })

  // Get optimistic update from context
  const optimisticUpdate = getProjectUpdate(project.todoist_id)

  // Use optimistic values if available, otherwise use real DB values
  const displayName =
    optimisticUpdate?.type === "text-change" && optimisticUpdate.newName !== undefined
      ? optimisticUpdate.newName
      : project.name
  const displayDescription =
    optimisticUpdate?.type === "text-change" && optimisticUpdate.newDescription !== undefined
      ? optimisticUpdate.newDescription
      : project.metadata?.description
  const displayPriority =
    optimisticUpdate?.type === "priority-change"
      ? optimisticUpdate.newPriority
      : project.metadata?.priority

  const priority = usePriority(displayPriority)
  const ProjectTypeIcon = getProjectTypeIcon(project.metadata?.projectType)

  const activeCount = project.stats.activeCount

  // Expose editing functions to parent (for keyboard shortcuts)
  useEffect(() => {
    const element = document.querySelector(`[data-project-id="${project.todoist_id}"]`) as HTMLElement & {
      startEditing?: () => void
      startEditingDescription?: () => void
    }
    if (element) {
      element.startEditing = editing.startEditing
      element.startEditingDescription = editing.startEditingSecondary
    }
  }, [project.todoist_id, editing.startEditing, editing.startEditingSecondary])

  const handleArchive = () => {
    openArchive(project)
  }

  // Clear optimistic updates when DB syncs (using shared hook)
  useOptimisticSync({
    entity: project,
    optimisticUpdate,
    shouldClear: (proj, update) => {
      if (update.type === "text-change") {
        // Name update completed
        if (update.newName !== undefined && update.newName === proj.name) {
          return true
        }
        // Description update completed
        if (update.newDescription !== undefined && update.newDescription === (proj.metadata?.description ?? "")) {
          return true
        }
      } else if (update.type === "priority-change") {
        // Priority update completed
        if (update.newPriority === proj.metadata?.priority) {
          return true
        }
      }
      return false
    },
    onClear: () => removeProjectUpdate(project.todoist_id)
  })

  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-project-id={project.todoist_id}
      data-entity-id={project.todoist_id}
      className={cn(
        "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
        "hover:bg-accent/50",
        "focus:outline-none focus:bg-accent/50 focus:border-primary/30",
        project.is_archived && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Color Indicator */}
        <div
          className="w-4 h-4 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />

        {/* Project Type Icon */}
        {ProjectTypeIcon && (
          <ProjectTypeIcon
            size="sm"
            className="shrink-0 mt-0.5 text-muted-foreground"
          />
        )}

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
                  placeholder="Project name"
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
                {/* Project Name */}
                <div className="font-medium text-sm leading-relaxed break-words">
                  {displayName}
                </div>

                {/* Description - shown like tasks do */}
                {displayDescription && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed break-words">
                    {displayDescription}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1">
            {/* Priority Badge - real or ghost */}
            {(priority?.showFlag || isHovered) && (
              <PriorityBadge
                priority={priority || { label: "P4", colorClass: null }}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick?.()
                  openPriority(project)
                }}
                isGhost={!priority?.showFlag}
              />
            )}

            {/* Active Tasks Count */}
            {activeCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 font-normal">
                <span className="text-xs">{activeCount} task{activeCount !== 1 ? 's' : ''}</span>
              </Badge>
            )}

            {/* Archive/Unarchive Button (shown on hover) */}
            {isHovered && (
              project.is_archived ? (
                <Badge
                  variant="outline"
                  className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClick?.()
                    onUnarchive?.(project.todoist_id)
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
          </div>
        </div>
      </div>
    </div>
  )
})
