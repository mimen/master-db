import { useAction, useQuery } from "convex/react"
import { RotateCcw, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ProjectRow } from "./ProjectRow"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCountRegistry } from "@/contexts/CountContext"
import { useFocusContext } from "@/contexts/FocusContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"
import { useProjectDialogShortcuts } from "@/hooks/useProjectDialogShortcuts"
import { useListItemFocus } from "@/hooks/list-items"
import { cn } from "@/lib/utils"
import type { ListInstance } from "@/lib/views/types"
import type { TodoistProjectsWithMetadata, TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectsListViewProps {
  list: ListInstance
  onProjectCountChange?: (listId: string, count: number) => void
  onProjectClick?: (listId: string, projectIndex: number) => void
  focusedProjectIndex: number | null
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean
}

export function ProjectsListView({
  list,
  onProjectCountChange,
  onProjectClick,
  focusedProjectIndex,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false
}: ProjectsListViewProps) {
  const [isExpanded, setIsExpanded] = useState(list.startExpanded)
  const { registry } = useCountRegistry()
  const { setFocusedProject } = useFocusContext()
  const { getProjectUpdate } = useOptimisticUpdates()

  const allProjects: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata,
    {}
  )

  const unarchiveProject = useAction(api.todoist.actions.unarchiveProject.unarchiveProject)

  const handleUnarchive = useCallback(async (projectId: string) => {
    await unarchiveProject({ projectId })
  }, [unarchiveProject])

  const projectRefs = useRef<(HTMLDivElement | null)[]>([])

  // Filter out deleted projects and sort by priority (4→3→2→1), then alphabetically
  // Note: Query already sorts archived projects to the bottom, we just maintain that here
  // IMPORTANT: Apply optimistic priority overrides BEFORE sorting
  const projects = useMemo(() => {
    if (!allProjects) return []

    return allProjects
      .filter((p: TodoistProjectWithMetadata) => !p.is_deleted)
      .sort((a: TodoistProjectWithMetadata, b: TodoistProjectWithMetadata) => {
        // Keep archived projects at the bottom (query already sorts this way)
        if (a.is_archived !== b.is_archived) {
          return a.is_archived ? 1 : -1
        }
        // Check for optimistic priority updates
        const aOptimistic = getProjectUpdate(a.todoist_id)
        const bOptimistic = getProjectUpdate(b.todoist_id)

        const aPriority =
          aOptimistic?.type === "priority-change"
            ? aOptimistic.newPriority
            : a.metadata?.priority ?? 1
        const bPriority =
          bOptimistic?.type === "priority-change"
            ? bOptimistic.newPriority
            : b.metadata?.priority ?? 1

        // Sort by priority descending (4→3→2→1 means P1→P2→P3→P4)
        if (aPriority !== bPriority) {
          return bPriority - aPriority
        }

        // Then alphabetically by name
        return a.name.localeCompare(b.name)
      })
  }, [allProjects, getProjectUpdate])

  const visibleProjects = list.maxTasks ? projects.slice(0, list.maxTasks) : projects

  // Get total count from CountRegistry
  const totalCount = registry.getCountForList(list.id, list.query)

  projectRefs.current.length = visibleProjects.length

  // Use shared focus management hook
  useListItemFocus({
    entityType: 'project',
    focusedIndex: focusedProjectIndex,
    entitiesLength: visibleProjects.length,
    elementRefs: projectRefs,
    onExpand: () => setIsExpanded(true)
  })

  const focusedProject =
    focusedProjectIndex !== null &&
    focusedProjectIndex >= 0 &&
    focusedProjectIndex < visibleProjects.length
      ? visibleProjects[focusedProjectIndex]
      : null

  // Update global focus context when focused project changes
  useEffect(() => {
    setFocusedProject(focusedProject)
  }, [focusedProject, setFocusedProject])

  useProjectDialogShortcuts(focusedProject)

  useEffect(() => {
    onProjectCountChange?.(list.id, visibleProjects.length)
  }, [list.id, onProjectCountChange, visibleProjects.length])

  useEffect(() => {
    setIsExpanded(list.startExpanded)
  }, [list.id, list.startExpanded])

  const header = list.getHeader({
    params: list.params,
    taskCount: visibleProjects.length,
    support: {},
  })

  const emptyState = list.getEmptyState({
    params: list.params,
    taskCount: visibleProjects.length,
    support: {},
  })

  const isLoading = allProjects === undefined

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading projects...</p>
      </div>
    )
  }

  // Show compact view ONLY in multi-list views for:
  // 1. Empty lists (always compact by default)
  // 2. Dismissed lists (manually collapsed, shows project count)
  const shouldShowCompact = isMultiListView && (visibleProjects.length === 0 || isDismissed)

  if (shouldShowCompact) {
    const projectCountText = totalCount === 0
      ? "Empty"
      : `${totalCount}`

    return (
      <div className="max-w-4xl mx-auto px-6 py-2">
        <div className="flex items-center gap-3 text-sm">
          <div className="text-muted-foreground">{header.icon}</div>
          <span className="flex-1 font-medium text-foreground/70">{header.title}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {projectCountText}
          </Badge>
          {visibleProjects.length > 0 && (
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
              {list.maxTasks && visibleProjects.length < totalCount
                ? `Showing ${visibleProjects.length} of ${totalCount}`
                : totalCount}
            </Badge>
            {visibleProjects.length > 0 && (
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
          {visibleProjects.length > 0 ? (
            <div className="space-y-1">
              {visibleProjects.map((project: TodoistProjectWithMetadata, index: number) => (
                <ProjectRow
                  key={project._id}
                  project={project}
                  onElementRef={(el) => projectRefs.current[index] = el}
                  onClick={() => onProjectClick?.(list.id, index)}
                  onUnarchive={handleUnarchive}
                />
              ))}
            </div>
          ) : list.collapsible && isMultiListView ? (
            <div className="py-4 text-sm text-muted-foreground text-center">No projects</div>
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
