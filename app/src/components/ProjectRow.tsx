import { Flag } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useDialogContext } from "@/contexts/DialogContext"
import { api } from "@/convex/_generated/api"
import { useTodoistAction } from "@/hooks/useTodoistAction"
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
  // UI-level optimistic values - shown while waiting for DB sync
  const [optimisticName, setOptimisticName] = useState<string | null>(null)
  const [optimisticDescription, setOptimisticDescription] = useState<string | null>(null)
  const lastSyncedNameRef = useRef(project.name)
  const lastSyncedDescriptionRef = useRef(project.metadata?.description ?? "")
  const nameInputRef = useRef<HTMLInputElement>(null)
  const descriptionInputRef = useRef<HTMLInputElement>(null)

  const { openPriority } = useDialogContext()

  const updateProjectName = useTodoistAction(
    api.todoist.publicActions.updateProjectName,
    {
      loadingMessage: "Updating project name...",
      successMessage: "Project name updated!",
      errorMessage: "Failed to update project name"
    }
  )

  const updateProjectDescription = useTodoistAction(
    api.todoist.publicActions.updateProjectMetadataDescription,
    {
      loadingMessage: "Updating description...",
      successMessage: "Description updated!",
      errorMessage: "Failed to update description"
    }
  )

  const priority = usePriority(project.metadata?.priority)

  // Use optimistic values if available, otherwise use real DB values
  const displayName = optimisticName ?? project.name
  const displayDescription = optimisticDescription ?? project.metadata?.description

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
    // Clear any optimistic values when canceling
    setOptimisticName(null)
    setOptimisticDescription(null)
  }

  const saveEditing = async () => {
    const hasNameChanged = editName !== project.name
    const hasDescriptionChanged = editDescription !== (project.metadata?.description || "")

    if (!hasNameChanged && !hasDescriptionChanged) {
      setIsEditing(false)
      return
    }

    // STEP 1: Set UI-level optimistic values immediately (0ms - instant!)
    if (hasNameChanged) setOptimisticName(editName)
    if (hasDescriptionChanged) setOptimisticDescription(editDescription)

    // STEP 2: Exit edit mode - optimistic values will show immediately
    setIsEditing(false)
    setShowDescriptionInput(false)

    // STEP 3: Fire actions in background (calls API + syncs to DB on success)
    if (hasNameChanged) {
      const result = await updateProjectName({
        projectId: project.todoist_id,
        name: editName
      })
      if (result === null) {
        setOptimisticName(null)
      }
    }

    if (hasDescriptionChanged) {
      const result = await updateProjectDescription({
        projectId: project.todoist_id,
        description: editDescription
      })
      if (result === null) {
        setOptimisticDescription(null)
      }
    }
  }

  // Clear optimistic values when DB value changes (API completed and synced)
  useEffect(() => {
    if (project.name !== lastSyncedNameRef.current) {
      lastSyncedNameRef.current = project.name
      setOptimisticName(null)
    }
  }, [project.name])

  useEffect(() => {
    const normalizedDescription = project.metadata?.description ?? ""
    if (normalizedDescription !== lastSyncedDescriptionRef.current) {
      lastSyncedDescriptionRef.current = normalizedDescription
      setOptimisticDescription(null)
    }
  }, [project.metadata?.description])

  // Focus name input when entering edit mode
  useEffect(() => {
    if (isEditing && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isEditing])

  return (
    <div
      ref={onElementRef}
      tabIndex={-1}
      aria-selected={false}
      onClick={onClick}
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

            {/* Active Tasks Count */}
            {activeCount > 0 && (
              <Badge variant="secondary" className="gap-1.5 font-normal">
                <span className="text-xs">{activeCount} task{activeCount !== 1 ? 's' : ''}</span>
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
