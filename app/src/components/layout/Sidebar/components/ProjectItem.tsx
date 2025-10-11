import { Flag } from "lucide-react"

import type { ProjectTreeNode } from "../types"

import { CountBadge } from "./CountBadge"

import { Button } from "@/components/ui/button"
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
}

export function ProjectItem({
  project,
  currentViewKey,
  onViewChange,
  expandNested,
  level = 0,
  viewContext,
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

  return (
    <>
      <Button
        key={project._id}
        variant="ghost"
        className={cn("w-full justify-start h-8 px-3 text-sm", isActive && "bg-accent")}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={handleProjectClick}
      >
        <div
          className="w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />
        <span className="flex-1 text-left truncate">{project.name}</span>
        {priority?.showFlag && (
          <Flag className={cn("w-2.5 h-2.5 mr-2 flex-shrink-0", priority.colorClass)} fill="currentColor" />
        )}
        {hasActiveItems && <CountBadge count={project.stats.activeCount} />}
      </Button>

      {project.children.map((child) => (
        <ProjectItem
          key={child._id}
          project={child}
          currentViewKey={currentViewKey}
          onViewChange={onViewChange}
          expandNested={expandNested}
          level={level + 1}
          viewContext={viewContext}
        />
      ))}
    </>
  )
}
