import { Repeat } from "lucide-react"

import { SidebarButton } from "../components/SidebarButton"

import { SidebarMenuItem } from "@/components/ui/sidebar"
import { getProjectColor } from "@/lib/colors"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface RoutineProjectItemProps {
  project: TodoistProjectWithMetadata
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  count: number
}

export function RoutineProjectItem({
  project,
  currentViewKey,
  onViewChange,
  viewContext,
  count,
}: RoutineProjectItemProps) {
  // View key for this project's routines
  const viewKey = `view:routines:project:${project.todoist_id}` as ViewKey
  const isActive = currentViewKey === viewKey

  // Routine icon colored to project color
  const routineIcon = (
    <Repeat
      className="h-4 w-4 flex-shrink-0"
      style={{ color: getProjectColor(project.color) }}
    />
  )

  const handleClick = () => {
    onViewChange(resolveView(viewKey, viewContext))
  }

  return (
    <SidebarMenuItem>
      <SidebarButton
        icon={routineIcon}
        label={project.name}
        count={count}
        isActive={isActive}
        onClick={handleClick}
        level={1}
      />
    </SidebarMenuItem>
  )
}
