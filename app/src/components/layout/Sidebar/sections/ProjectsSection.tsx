import { ArrowDownAZ, ChevronRight, Flag, Hash, Network, Plus } from "lucide-react"

import { ProjectItem } from "../components/ProjectItem"
import { SortToggle } from "../components/SortToggle"
import type { ProjectSort, ProjectTreeNode } from "../types"
import { getSortedProjects } from "../utils/sorting"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { cn } from "@/lib/utils"

interface ProjectsSectionProps {
  projects: ProjectTreeNode[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  expandNested: boolean
  onExpandNestedChange: (value: boolean) => void
  sortMode: ProjectSort
  onSortChange: (mode: ProjectSort) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

const PROJECT_SORT_MODES: readonly ProjectSort[] = ["hierarchy", "priority", "taskCount", "alphabetical"]

function getProjectSortIcon(mode: ProjectSort) {
  switch (mode) {
    case "hierarchy":
      return Network
    case "priority":
      return Flag
    case "taskCount":
      return Hash
    case "alphabetical":
      return ArrowDownAZ
  }
}

export function ProjectsSection({
  projects,
  currentViewKey,
  onViewChange,
  viewContext,
  expandNested,
  onExpandNestedChange,
  sortMode,
  onSortChange,
  isCollapsed,
  onToggleCollapse,
}: ProjectsSectionProps) {
  const sortedProjects = getSortedProjects(projects, sortMode)

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggleCollapse}>
      <SidebarGroup>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 flex items-center gap-1">
              <ChevronRight className={cn("h-3 w-3 transition-transform", !isCollapsed && "rotate-90")} />
              Projects
            </SidebarGroupLabel>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1 pr-2">
            <SortToggle
              modes={PROJECT_SORT_MODES}
              currentMode={sortMode}
              onToggle={onSortChange}
              getIcon={getProjectSortIcon}
            />
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          {sortMode === "hierarchy" && (
            <div className="mb-3 flex items-center gap-2 px-3">
              <input
                type="checkbox"
                id="expand-nested"
                checked={expandNested}
                onChange={(e) => onExpandNestedChange(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300"
              />
              <label htmlFor="expand-nested" className="text-xs text-muted-foreground cursor-pointer">
                Load nested projects
              </label>
            </div>
          )}

          <SidebarMenu className="space-y-0.5 max-h-96 overflow-y-auto scrollbar-hide">
            {sortedProjects.map((project) => (
              <ProjectItem
                key={project._id}
                project={project}
                currentViewKey={currentViewKey}
                onViewChange={onViewChange}
                expandNested={expandNested}
                level={0}
                viewContext={viewContext}
              />
            ))}

            {(!sortedProjects || sortedProjects.length === 0) && (
              <p className="text-xs text-muted-foreground text-center py-4">No projects found</p>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
