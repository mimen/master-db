import type { MouseEvent } from "react"

import type { ProjectTreeNode } from "../types"
import { getTotalActiveCount } from "../utils/projectTree"

import { SidebarButton } from "./SidebarButton"

import { ProjectColorIndicator } from "@/components/ProjectColorIndicator"
import { SidebarMenuItem } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface ProjectItemProps {
  project: ProjectTreeNode
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  expandNested: boolean
  level?: number
  viewContext: ViewBuildContext
  toggleProjectCollapse: (projectId: string) => void
  isProjectCollapsed: (projectId: string) => boolean
  sortMode?: "hierarchy" | "priority" | "taskCount" | "alphabetical"
  onMoveProject?: (projectId: string, e: MouseEvent) => void
}

export function ProjectItem({
  project,
  currentViewKey,
  onViewChange,
  expandNested,
  level = 0,
  viewContext,
  toggleProjectCollapse,
  isProjectCollapsed,
  sortMode,
  onMoveProject,
}: ProjectItemProps) {
  const projectViewKey = `view:project:${project.todoist_id}` as ViewKey
  const projectFamilyKey = `view:project-family:${project.todoist_id}` as ViewKey
  const isActive = currentViewKey === projectViewKey || currentViewKey === projectFamilyKey
  const hasChildren = project.children.length > 0
  const isCollapsed = isProjectCollapsed(project.todoist_id)

  // When collapsed with children, show total count including descendants
  const displayCount = isCollapsed && hasChildren
    ? getTotalActiveCount(project)
    : project.stats.activeCount
  const hasActiveItems = displayCount > 0

  const handleProjectClick = () => {
    if (expandNested && hasChildren) {
      const viewKey = `view:project-family:${project.todoist_id}` as ViewKey
      onViewChange(resolveView(viewKey, viewContext))
    } else {
      onViewChange(resolveView(`view:project:${project.todoist_id}` as ViewKey, viewContext))
    }
  }

  const handleToggleCollapse = (e: MouseEvent) => {
    e.stopPropagation()
    toggleProjectCollapse(project.todoist_id)
  }

  const projectIcon = <ProjectColorIndicator project={project} size="md" className="mr-2" />

  return (
    <>
      <SidebarMenuItem>
        <SidebarButton
          icon={projectIcon}
          label={project.name}
          count={hasActiveItems ? displayCount : null}
          isActive={isActive}
          onClick={handleProjectClick}
          level={level}
          hasChildren={hasChildren}
          isCollapsed={isCollapsed}
          onToggleCollapse={handleToggleCollapse}
          sortMode={sortMode}
          onMoveClick={onMoveProject ? (e) => onMoveProject(project.todoist_id, e) : undefined}
        />
      </SidebarMenuItem>

      {hasChildren &&
        !isCollapsed &&
        project.children.map((child: ProjectTreeNode) => (
          <ProjectItem
            key={child._id}
            project={child}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            level={level + 1}
            viewContext={viewContext}
            toggleProjectCollapse={toggleProjectCollapse}
            isProjectCollapsed={isProjectCollapsed}
            sortMode={sortMode}
            onMoveProject={onMoveProject}
          />
        ))}
    </>
  )
}
