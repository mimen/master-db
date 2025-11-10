import { ArrowDownAZ, Flag, Hash, Network, Plus } from "lucide-react"

import { CollapseCaret } from "../components/CollapseCaret"
import { IconButton } from "../components/IconButton"
import { ProjectItem } from "../components/ProjectItem"
import { SortDropdown } from "../components/SortDropdown"
import type { ProjectSort, ProjectTreeNode } from "../types"
import { getSortedProjects } from "../utils/sorting"

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
      // Render grouped by priority with headers
      return (
        <>
          {[4, 3, 2, 1].map((priorityLevel) => {
            const projectsInGroup = groupedByPriority[priorityLevel]
            if (!projectsInGroup || projectsInGroup.length === 0) return null

            const priorityInfo = getPriorityInfo(priorityLevel)
            if (!priorityInfo) return null

            const isGroupCollapsed = isPriorityGroupCollapsed(priorityLevel)

            return (
              <div key={priorityLevel}>
                <div className="flex items-center justify-between py-1.5 mb-1 pl-3 pr-2">
                  <div className="flex items-center gap-2">
                    <Flag className={cn("w-3 h-3", getPriorityColorClass(priorityLevel))} fill="currentColor" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {priorityInfo.uiPriority}
                    </span>
                  </div>
                  <CollapseCaret
                    isCollapsed={isGroupCollapsed}
                    onToggle={(e) => {
                      e.stopPropagation()
                      togglePriorityGroupCollapse(priorityLevel)
                    }}
                  />
                </div>
                {!isGroupCollapsed && (
                  <SidebarMenu className="space-y-px pl-3">
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
            showPriorityFlag={false}
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
