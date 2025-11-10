import type { ProjectTreeNode } from "../types"

import { SidebarButton } from "./SidebarButton"

import { SidebarMenuItem } from "@/components/ui/sidebar"
import { getProjectColor } from "@/lib/colors"
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
}: ProjectItemProps) {
  const projectViewKey = `view:project:${project.todoist_id}` as ViewKey
  const projectFamilyKey = `view:project-family:${project.todoist_id}` as ViewKey
  const isActive = currentViewKey === projectViewKey || currentViewKey === projectFamilyKey
  const hasActiveItems = project.stats.activeCount > 0
  const hasChildren = project.children.length > 0
  const isCollapsed = isProjectCollapsed(project.todoist_id)

  const handleProjectClick = () => {
    if (expandNested && hasChildren) {
      const viewKey = `view:project-family:${project.todoist_id}` as ViewKey
      onViewChange(resolveView(viewKey, viewContext))
    } else {
      onViewChange(resolveView(`view:project:${project.todoist_id}` as ViewKey, viewContext))
    }
  }

  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleProjectCollapse(project.todoist_id)
  }

  const projectIcon = (
    <div
      className="w-3 h-3 rounded-full flex-shrink-0 mr-2"
      style={{ backgroundColor: getProjectColor(project.color) }}
    />
  )

  return (
    <>
      <SidebarMenuItem>
        <SidebarButton
          icon={projectIcon}
          label={project.name}
          count={hasActiveItems ? project.stats.activeCount : null}
          isActive={isActive}
          onClick={handleProjectClick}
          level={level}
          hasChildren={hasChildren}
          isCollapsed={isCollapsed}
          onToggleCollapse={handleToggleCollapse}
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
          />
        ))}
    </>
  )
}
