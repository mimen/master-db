import { ArrowDownAZ, Hash, Network } from "lucide-react"
import { useMemo } from "react"

import { CollapseCaret } from "../components/CollapseCaret"
import { SortDropdown } from "../components/SortDropdown"
import type { RoutineSort } from "../types"
import { buildProjectTree, flattenProjects } from "../utils/projectTree"

import { RoutineProjectItem } from "./RoutineProjectItem"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"

interface RoutinesSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  isCollapsed: boolean
  onToggleCollapse: () => void
  sortMode: RoutineSort
  onSortChange: (sort: RoutineSort) => void
}

const ROUTINE_SORT_MODES: readonly RoutineSort[] = ["flat", "projectOrder", "routineCount"]

function getRoutineSortIcon(mode: RoutineSort) {
  switch (mode) {
    case "flat":
      return ArrowDownAZ
    case "projectOrder":
      return Network
    case "routineCount":
      return Hash
  }
}

export function RoutinesSection({
  currentViewKey,
  onViewChange,
  viewContext,
  isCollapsed,
  onToggleCollapse,
  sortMode,
  onSortChange,
}: RoutinesSectionProps) {
  const { registry } = useCountRegistry()

  // Filter projects that have routines (active routine count > 0)
  const projectsWithRoutines = useMemo(() => {
    if (!viewContext.projectsWithMetadata) return []

    // Get all list counts directly
    const allCounts = registry.getAllCounts()

    return viewContext.projectsWithMetadata.filter((project) => {
      // Use the list count key directly: list:routines:{projectId}
      const countKey = `list:routines:${project.todoist_id}`
      const count = allCounts[countKey] ?? 0
      return count > 0
    })
  }, [viewContext, registry])

  // Sort projects based on sort mode
  const sortedProjects = useMemo(() => {
    if (projectsWithRoutines.length === 0) return []

    switch (sortMode) {
      case "flat": {
        // Alphabetical sort (flat)
        return [...projectsWithRoutines].sort((a, b) => a.name.localeCompare(b.name))
      }

      case "projectOrder": {
        // Hierarchical order but flattened display
        const tree = buildProjectTree(projectsWithRoutines)
        const flattened = flattenProjects(tree)
        // Return the original objects (not tree nodes) in hierarchical order
        return flattened.map((node) => {
          const original = projectsWithRoutines.find((p) => p.todoist_id === node.todoist_id)
          return original!
        })
      }

      case "routineCount": {
        // Sort by routine count descending
        const allCounts = registry.getAllCounts()
        const projectsWithCounts = projectsWithRoutines.map((project) => {
          const countKey = `list:routines:${project.todoist_id}`
          const count = allCounts[countKey] ?? 0
          return { project, count }
        })

        return projectsWithCounts
          .sort((a, b) => b.count - a.count)
          .map((item) => item.project)
      }

      default:
        return projectsWithRoutines
    }
  }, [projectsWithRoutines, sortMode, registry])

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <SidebarGroupLabel className="flex-1">Routines</SidebarGroupLabel>
          <div className="flex items-center pr-2">
            <SortDropdown
              modes={ROUTINE_SORT_MODES}
              currentMode={sortMode}
              onChange={onSortChange}
              getIcon={getRoutineSortIcon}
            />
            <CollapsibleTrigger asChild>
              <CollapseCaret
                isCollapsed={isCollapsed}
                onToggle={(e) => {
                  e.preventDefault()
                  onToggleCollapse()
                }}
              />
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <SidebarMenu className="space-y-0.5">
            {sortedProjects.map((project) => {
              const countKey = `list:routines:${project.todoist_id}`
              const count = registry.getAllCounts()[countKey] ?? 0

              return (
                <RoutineProjectItem
                  key={project._id}
                  project={project}
                  currentViewKey={currentViewKey}
                  onViewChange={onViewChange}
                  viewContext={viewContext}
                  count={count}
                />
              )
            })}
            {sortedProjects.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No projects with routines yet
              </p>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
