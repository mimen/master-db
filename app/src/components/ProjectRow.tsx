import { Archive, Flag } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useDialogContext } from "@/contexts/DialogContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { useOptimisticProjectDescription } from "@/hooks/useOptimisticProjectDescription"
import { useOptimisticProjectName } from "@/hooks/useOptimisticProjectName"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectRowProps {
  project: TodoistProjectWithMetadata
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
}

export const ProjectRow = memo(function ProjectRow({ project, onElementRef, onClick }: ProjectRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [showDescriptionInput, setShowDescriptionInput] = useState(false)
  const [editName, setEditName] = useState(project.name)
  const [editDescription, setEditDescription] = useState(project.metadata?.description || "")
  const [isHovered, setIsHovered] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLInputElement>(null)

  const { openPriority, openArchive } = useDialogContext()
  const { getProjectUpdate, removeProjectUpdate } = useOptimisticUpdates()

  const updateProjectName = useOptimisticProjectName()
  const updateProjectDescription = useOptimisticProjectDescription()

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

  const activeCount = project.stats.activeCount

  const startEditing = useCallback(() => {
    setIsEditing(true)
    // Only show description input if project already has a description
    setShowDescriptionInput(!!project.metadata?.description)
    // Use real DB values when entering edit mode, not optimistic ones
    setEditName(project.name)
    setEditDescription(project.metadata?.description || "")
  }, [project.name, project.metadata?.description])

  const startEditingDescription = useCallback(() => {
    setIsEditing(true)
    // Always show description input when explicitly editing description
    setShowDescriptionInput(true)
    // Use real DB values when entering edit mode, not optimistic ones
    setEditName(project.name)
    setEditDescription(project.metadata?.description || "")
    // Focus description input after state update
    setTimeout(() => {
      descriptionInputRef.current?.focus()
    }, 0)
  }, [project.name, project.metadata?.description])

  // Expose startEditing and startEditingDescription to parent
  useEffect(() => {
    const element = document.querySelector(`[data-project-id="${project.todoist_id}"]`) as HTMLElement & {
      startEditing?: () => void
      startEditingDescription?: () => void
    }
    if (element) {
      element.startEditing = startEditing
      element.startEditingDescription = startEditingDescription
    }
  }, [project.todoist_id, startEditing, startEditingDescription])

  const cancelEditing = () => {
    setIsEditing(false)
    setShowDescriptionInput(false)
    setEditName(project.name)
    setEditDescription(project.metadata?.description || "")
  }

  const saveEditing = async () => {
    const hasNameChanged = editName !== project.name
    const hasDescriptionChanged = editDescription !== (project.metadata?.description || "")

    if (!hasNameChanged && !hasDescriptionChanged) {
      setIsEditing(false)
      return
    }

    // Exit edit mode - optimistic values will show immediately
    setIsEditing(false)
    setShowDescriptionInput(false)

    // Fire optimistic updates (instant UI + background API calls)
    if (hasNameChanged) {
      await updateProjectName(project.todoist_id, editName)
    }

    if (hasDescriptionChanged) {
      await updateProjectDescription(project.todoist_id, editDescription)
    }
  }

  // Focus name input when entering edit mode
  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditing])

  const handleArchive = () => {
    openArchive(project)
  }

  // Clear optimistic updates when DB syncs (success case)
  useEffect(() => {
    const update = getProjectUpdate(project.todoist_id)
    if (!update) return

    let shouldClear = false

    if (update.type === "text-change") {
      // If optimistic name matches DB, name update completed
      if (update.newName !== undefined && update.newName === project.name) {
        shouldClear = true
      }

      // If optimistic description matches DB, description update completed
      if (
        update.newDescription !== undefined &&
        update.newDescription === (project.metadata?.description ?? "")
      ) {
        shouldClear = true
      }
    } else if (update.type === "priority-change") {
      // If optimistic priority matches DB, priority update completed
      if (update.newPriority === project.metadata?.priority) {
        shouldClear = true
      }
    }

    if (shouldClear) {
      removeProjectUpdate(project.todoist_id)
    }
  }, [
    project.todoist_id,
    project.name,
    project.metadata?.description,
    project.metadata?.priority,
    getProjectUpdate,
    removeProjectUpdate
  ])

  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-project-id={project.todoist_id}
      className={cn(
        "group cursor-pointer transition-all duration-150 rounded-md border border-transparent p-2.5",
        "hover:bg-accent/50",
        "focus:outline-none focus:bg-accent/50 focus:border-primary/30"
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Color Indicator */}
        <div
          className="w-4 h-4 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />

        <div className="flex-1 min-w-0 space-y-1.5">
          <div onClick={(e) => e.stopPropagation()}>
            {isEditing ? (
              <>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
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
                  placeholder="Project name"
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
                        nameInputRef.current?.focus()
                      }
                    }}
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
            {/* Priority Badge */}
            {priority?.showFlag && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={cn(
                        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
                        priority.colorClass
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        openPriority(project)
                      }}
                    >
                      <Flag className="h-3 w-3" fill="currentColor" />
                      <span>{priority.label}</span>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Priority: {priority.label}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* P4 Ghost Badge (shown on hover when priority is P4) */}
            {isHovered && !priority?.showFlag && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  openPriority(project)
                }}
              >
                <Flag className="h-3 w-3" />
                <span>P4</span>
              </Badge>
            )}

            {/* Active Tasks Count */}
            {activeCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 font-normal">
                <span className="text-xs">{activeCount} task{activeCount !== 1 ? 's' : ''}</span>
              </Badge>
            )}

            {/* Archive Button (shown on hover) */}
            {isHovered && (
              <Badge
                variant="outline"
                className="gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors text-muted-foreground border-dashed"
                onClick={(e) => {
                  e.stopPropagation()
                  handleArchive()
                }}
              >
                <Archive className="h-3 w-3" />
                <span>Archive</span>
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
