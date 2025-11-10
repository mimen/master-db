import { ArrowDownAZ, Flag, Hash, Network, Plus } from "lucide-react"

import { CollapseCaret } from "../components/CollapseCaret"
import { IconButton } from "../components/IconButton"
import { PriorityItem } from "../components/PriorityItem"
import { ProjectItem } from "../components/ProjectItem"
import { SortDropdown } from "../components/SortDropdown"
import type { ProjectSort, ProjectTreeNode } from "../types"
import { PRIORITY_PROJECTS_ITEMS } from "../utils/filterItems"
import { getSortedProjects } from "../utils/sorting"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"

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
  toggleProjectCollapse: (projectId: string) => void
  isProjectCollapsed: (projectId: string) => boolean
  togglePriorityGroupCollapse: (priority: number) => void
  isPriorityGroupCollapsed: (priority: number) => boolean
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
  toggleProjectCollapse,
  isProjectCollapsed,
  togglePriorityGroupCollapse,
  isPriorityGroupCollapsed,
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
      // Render grouped by priority with PriorityItem headers
      return (
        <>
          {[4, 3, 2, 1].map((priorityLevel) => {
            const projectsInGroup = groupedByPriority[priorityLevel]
            if (!projectsInGroup || projectsInGroup.length === 0) return null

            // Find the corresponding priority-projects item
            const priorityItem = PRIORITY_PROJECTS_ITEMS.find((p) => p.priorityLevel === priorityLevel)
            if (!priorityItem) return null

            // Calculate total task count across all projects in this priority group
            const totalTaskCount = projectsInGroup.reduce((sum, project) => sum + (project.stats.activeCount || 0), 0)

            const isGroupCollapsed = isPriorityGroupCollapsed(priorityLevel)

            return (
              <div key={priorityLevel}>
                <PriorityItem
                  priority={priorityItem}
                  currentViewKey={currentViewKey}
                  onViewChange={onViewChange}
                  viewContext={viewContext}
                  count={totalTaskCount}
                  isCollapsible={true}
                  isCollapsed={isGroupCollapsed}
                  onToggle={(e) => {
                    e.stopPropagation()
                    togglePriorityGroupCollapse(priorityLevel)
                  }}
                />
                {!isGroupCollapsed && (
                  <SidebarMenu className="pl-4">
                    {projectsInGroup.map((project) => (
                      <ProjectItem
                        key={project._id}
                        project={project}
                        currentViewKey={currentViewKey}
                        onViewChange={onViewChange}
                        expandNested={expandNested}
                        level={0}
                        viewContext={viewContext}
                        toggleProjectCollapse={toggleProjectCollapse}
                        isProjectCollapsed={isProjectCollapsed}
                      />
                    ))}
                  </SidebarMenu>
                )}
              </div>
            )
          })}
        </>
      )
    }

    // Default rendering for other sort modes
    return (
      <SidebarMenu className="space-y-px">
        {sortedProjects.map((project) => (
          <ProjectItem
            key={project._id}
            project={project}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            level={0}
            viewContext={viewContext}
            toggleProjectCollapse={toggleProjectCollapse}
            isProjectCollapsed={isProjectCollapsed}
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
          <SidebarGroupLabel className="flex-1">Projects</SidebarGroupLabel>
          <div className="flex items-center pr-2">
            <SortDropdown
              modes={PROJECT_SORT_MODES}
              currentMode={sortMode}
              onChange={onSortChange}
              getIcon={getProjectSortIcon}
            />
            <IconButton>
              <Plus className="h-3 w-3" />
            </IconButton>
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
          {renderProjectList()}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
