import { useQuery } from "convex/react"
import { ChevronDown, ChevronRight, RotateCcw, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCountRegistry } from "@/contexts/CountContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"
import { useProjectDialogShortcuts } from "@/hooks/useProjectDialogShortcuts"
import { cn } from "@/lib/utils"
import type { ListInstance } from "@/lib/views/types"
import type { TodoistProjectsWithMetadata, TodoistProjectWithMetadata } from "@/types/convex/todoist"

import { ProjectRow } from "./ProjectRow"

const PROJECT_ROW_FOCUSED_CLASSNAMES = ["bg-accent/50", "border-primary/30"] as const

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
  const { getProjectUpdate } = useOptimisticUpdates()

  const allProjects: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.publicQueries.getProjectsWithMetadata,
    {}
  )

  const projectRefs = useRef<(HTMLDivElement | null)[]>([])
  const refHandlers = useRef<((element: HTMLDivElement | null) => void)[]>([])
  const lastFocusedIndex = useRef<number | null>(null)

  // Filter to active projects only and sort by priority (4→3→2→1), then alphabetically
  // IMPORTANT: Apply optimistic priority overrides BEFORE sorting
  const projects = useMemo(() => {
    if (!allProjects) return []

    return allProjects
      .filter((p: TodoistProjectWithMetadata) => !p.is_deleted && !p.is_archived)
      .sort((a: TodoistProjectWithMetadata, b: TodoistProjectWithMetadata) => {
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
  refHandlers.current.length = visibleProjects.length

  const focusedProject =
    focusedProjectIndex !== null &&
    focusedProjectIndex >= 0 &&
    focusedProjectIndex < visibleProjects.length
      ? visibleProjects[focusedProjectIndex]
      : null

  useProjectDialogShortcuts(focusedProject)

  useEffect(() => {
    onProjectCountChange?.(list.id, visibleProjects.length)
  }, [list.id, onProjectCountChange, visibleProjects.length])

  useEffect(() => {
    setIsExpanded(list.startExpanded)
  }, [list.id, list.startExpanded])

  useEffect(() => {
    const removeHighlight = (element: HTMLDivElement | null) => {
      if (!element) return
      PROJECT_ROW_FOCUSED_CLASSNAMES.forEach((className) => element.classList.remove(className))
      element.setAttribute("aria-selected", "false")
    }

    const applyHighlight = (element: HTMLDivElement | null) => {
      if (!element) return
      PROJECT_ROW_FOCUSED_CLASSNAMES.forEach((className) => element.classList.add(className))
      element.setAttribute("aria-selected", "true")
    }

    if (lastFocusedIndex.current !== null && lastFocusedIndex.current !== focusedProjectIndex) {
      removeHighlight(projectRefs.current[lastFocusedIndex.current])
    }

    if (focusedProjectIndex === null) {
      lastFocusedIndex.current = null
      return
    }

    if (focusedProjectIndex < 0 || focusedProjectIndex >= visibleProjects.length) {
      lastFocusedIndex.current = null
      return
    }

    setIsExpanded(true)
    const node = projectRefs.current[focusedProjectIndex]
    if (!node) {
      lastFocusedIndex.current = null
      return
    }

    if (
      lastFocusedIndex.current !== focusedProjectIndex ||
      !node.classList.contains(PROJECT_ROW_FOCUSED_CLASSNAMES[0])
    ) {
      applyHighlight(node)
    }

    if (typeof document !== "undefined" && node !== document.activeElement) {
      node.focus({ preventScroll: true })
    }

    const scrollContainer = node.closest("[data-task-scroll-container]") as HTMLElement | null
    if (scrollContainer) {
      const nodeRect = node.getBoundingClientRect()
      const containerRect = scrollContainer.getBoundingClientRect()
      const isAbove = nodeRect.top < containerRect.top
      const isBelow = nodeRect.bottom > containerRect.bottom
      if (isAbove || isBelow) {
        node.scrollIntoView({ block: "nearest", inline: "nearest" })
      }
    } else if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest", inline: "nearest" })
    }

    lastFocusedIndex.current = focusedProjectIndex
  }, [focusedProjectIndex, visibleProjects.length])

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

  const toggleExpanded = () => {
    setIsExpanded((prev) => !prev)
  }

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
            {list.collapsible && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleExpanded}
                      className="p-1.5 hover:bg-accent rounded-md transition-colors text-muted-foreground hover:text-foreground"
                      aria-label={isExpanded ? "Collapse list" : "Expand list"}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isExpanded ? "Collapse" : "Expand"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
              {visibleProjects.map((project: TodoistProjectWithMetadata, index: number) => {
                if (!refHandlers.current[index]) {
                  refHandlers.current[index] = (element) => {
                    projectRefs.current[index] = element
                    if (element === null && lastFocusedIndex.current === index) {
                      lastFocusedIndex.current = null
                    }
                  }
                }

                return (
                  <ProjectRow
                    key={project._id}
                    project={project}
                    onElementRef={refHandlers.current[index]!}
                    onClick={() => onProjectClick?.(list.id, index)}
                  />
                )
              })}
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
