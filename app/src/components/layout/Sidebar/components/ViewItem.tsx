import { SidebarButton } from "./SidebarButton"

import { ProjectColorIndicator } from "@/components/ProjectColorIndicator"
import { SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { getViewIcon } from "@/lib/icons/viewIcons"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import { getViewDefinition } from "@/lib/views/viewRegistry"

interface ViewItemProps {
  // Single source of truth
  viewKey: ViewKey

  // Navigation & state
  currentViewKey?: ViewKey
  onViewChange?: (view: ViewSelection) => void
  viewContext?: ViewBuildContext

  // Hierarchy
  level?: number // For indentation (0 = no indent)

  // Children/collapsible
  hasChildren?: boolean
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

/**
 * Base component for rendering any view in the sidebar
 *
 * This component is registry-driven - it takes only a view-key and automatically:
 * - Gets metadata (title, icon) from ViewRegistry
 * - Gets count from CountRegistry
 * - Handles navigation via resolveView
 * - Manages indentation and collapsible state
 */
export function ViewItem({
  viewKey,
  currentViewKey,
  onViewChange,
  viewContext,
  level = 0,
  hasChildren = false,
  isCollapsed = false,
  onToggleCollapse,
}: ViewItemProps) {
  // 1. Get metadata from ViewRegistry
  const viewDef = getViewDefinition(viewKey, viewContext)
  const title = viewDef?.metadata?.title || "Unknown"

  // 2. Get icon - special handling for project views
  let icon = getViewIcon(viewKey, { size: "sm" })

  // For project views, use colored circle indicator
  if (viewKey.startsWith("view:project:") && viewContext?.projectsWithMetadata) {
    const projectId = viewKey.replace("view:project:", "")
    const project = viewContext.projectsWithMetadata.find(p => p.todoist_id === projectId)
    if (project) {
      icon = <ProjectColorIndicator project={project} size="md" className="mr-1" />
    }
  }

  // 3. Get count from CountRegistry
  const { getCountForView } = useCountRegistry()
  const count = viewContext ? getCountForView(viewKey, viewContext) : null

  // 4. Determine active state
  const isActive = currentViewKey === viewKey

  // 5. Handle navigation
  const handleClick = () => {
    if (onViewChange && viewContext) {
      onViewChange(resolveView(viewKey, viewContext))
    }
  }

  // 6. Render with indentation
  return (
    <SidebarMenuItem>
      <SidebarButton
        icon={icon}
        label={title}
        count={count}
        isActive={isActive}
        onClick={handleClick}
        level={level}
        hasChildren={hasChildren}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
      />
    </SidebarMenuItem>
  )
}
