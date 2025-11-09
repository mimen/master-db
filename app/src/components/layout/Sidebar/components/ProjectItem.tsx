import { Flag } from "lucide-react"

import type { ProjectTreeNode } from "../types"

import { SidebarButton } from "./SidebarButton"

import { SidebarMenuItem } from "@/components/ui/sidebar"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

interface ProjectItemProps {
  project: ProjectTreeNode
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  expandNested: boolean
  level?: number
  viewContext: ViewBuildContext
  showPriorityFlag?: boolean
}

export function ProjectItem({
  project,
  currentViewKey,
  onViewChange,
  expandNested,
  level = 0,
  viewContext,
  showPriorityFlag = false,
}: ProjectItemProps) {
  const projectViewKey = `view:project:${project.todoist_id}` as ViewKey
  const projectFamilyKey = `view:project-family:${project.todoist_id}` as ViewKey
  const isActive = currentViewKey === projectViewKey || currentViewKey === projectFamilyKey
  const hasActiveItems = project.stats.activeCount > 0
  const hasChildren = project.children.length > 0

  const priority = usePriority(project.metadata?.priority)

  const handleProjectClick = () => {
    if (expandNested && hasChildren) {
      const viewKey = `view:project-family:${project.todoist_id}` as ViewKey
      onViewChange(resolveView(viewKey, viewContext))
    } else {
      onViewChange(resolveView(`view:project:${project.todoist_id}` as ViewKey, viewContext))
    }
  }

  const projectIcon = (
    <div
      className="w-3 h-3 rounded-full flex-shrink-0 mr-2"
      style={{ backgroundColor: getProjectColor(project.color) }}
    />
  )

  // If this is a nested item (level > 0), don't use SidebarMenuItem wrapper
  const content = (
    <>
      <SidebarButton
        icon={projectIcon}
        label={project.name}
        count={hasActiveItems ? project.stats.activeCount : null}
        isActive={isActive}
        onClick={handleProjectClick}
        level={level}
      >
        {showPriorityFlag && priority?.showFlag && (
          <Flag className={cn("w-3 h-3 flex-shrink-0", priority.colorClass)} fill="currentColor" />
        )}
      </SidebarButton>

      {hasChildren &&
        project.children.map((child: ProjectTreeNode) => (
          <ProjectItem
            key={child._id}
            project={child}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            level={level + 1}
            viewContext={viewContext}
            showPriorityFlag={showPriorityFlag}
          />
        ))}
    </>
  )

  // Top-level items need SidebarMenuItem wrapper, nested ones don't
  if (level === 0) {
    return <SidebarMenuItem>{content}</SidebarMenuItem>
  }

  return content
}
