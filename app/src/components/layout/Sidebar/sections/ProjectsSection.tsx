import { ArrowDownAZ, ChevronRight, Flag, Hash, Network, Plus } from "lucide-react"

import { ProjectItem } from "../components/ProjectItem"
import { SortToggle } from "../components/SortToggle"
import type { ProjectSort, ProjectTreeNode } from "../types"
import { getSortedProjects } from "../utils/sorting"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import { getPriorityColorClass, getPriorityInfo } from "@/lib/priorities"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { cn } from "@/lib/utils"

interface ProjectsSectionProps {
  projects: ProjectTreeNode[]
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  expandNested: boolean
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
  sortMode,
  onSortChange,
  isCollapsed,
  onToggleCollapse,
}: ProjectsSectionProps) {
  const sortedProjects = getSortedProjects(projects, sortMode)

  // Group projects by priority when sorting by priority
  const groupedByPriority = sortMode === "priority"
    ? sortedProjects.reduce((acc: Record<number, ProjectTreeNode[]>, project: ProjectTreeNode) => {
        const priority = project.metadata?.priority || 1
        if (!acc[priority]) acc[priority] = []
        acc[priority].push(project)
        return acc
      }, {} as Record<number, ProjectTreeNode[]>)
    : null

  const renderProjectList = () => {
    if (sortMode === "priority" && groupedByPriority) {
      // Render grouped by priority with headers
      return (
        <>
          {[4, 3, 2].map((priorityLevel) => {
            const projectsInGroup = groupedByPriority[priorityLevel]
            if (!projectsInGroup || projectsInGroup.length === 0) return null

            const priorityInfo = getPriorityInfo(priorityLevel)
            if (!priorityInfo) return null

            return (
              <div key={priorityLevel} className="mb-3 first:mt-0">
                <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
                  <Flag className={cn("w-3 h-3", getPriorityColorClass(priorityLevel))} fill="currentColor" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {priorityInfo.uiPriority}
                  </span>
                </div>
                <SidebarMenu className="space-y-0.5">
                  {projectsInGroup.map((project) => (
                    <ProjectItem
                      key={project._id}
                      project={project}
                      currentViewKey={currentViewKey}
                      onViewChange={onViewChange}
                      expandNested={expandNested}
                      level={0}
                      viewContext={viewContext}
                      showPriorityFlag={false}
                    />
                  ))}
                </SidebarMenu>
              </div>
            )
          })}
        </>
      )
    }

    // Default rendering for other sort modes
    return (
      <SidebarMenu className="space-y-0.5">
        {sortedProjects.map((project) => (
          <ProjectItem
            key={project._id}
            project={project}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            level={0}
            viewContext={viewContext}
            showPriorityFlag={false}
          />
        ))}

        {(!sortedProjects || sortedProjects.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-4">No projects found</p>
        )}
      </SidebarMenu>
    )
  }

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
          {renderProjectList()}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
