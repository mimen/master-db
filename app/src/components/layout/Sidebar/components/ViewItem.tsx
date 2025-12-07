import type { ElementType, ReactNode } from "react"

import { SidebarButton } from "./SidebarButton"

import { ProjectColorIndicator } from "@/components/ProjectColorIndicator"
import { SidebarMenuItem } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { getViewIcon } from "@/lib/icons/viewIcons"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import { getViewDefinition } from "@/lib/views/viewRegistry"

export interface SortConfig {
  modes: readonly string[]
  currentMode: string
  onChange: (mode: string) => void
  getIcon: (mode: string) => ElementType<{ className?: string }>
}

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

  // Sorting (for expandable views with sortOptions)
  sortConfig?: SortConfig
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
  sortConfig,
}: ViewItemProps) {
  // 1. Get metadata from ViewRegistry
  const viewDef = getViewDefinition(viewKey, viewContext)
  const title = viewDef?.metadata?.title || "Unknown"

  // 2. Get icon - special handling for project views
  let icon: ReactNode = null

  // For project views, use colored circle indicator
  if (viewKey.startsWith("view:project:") && viewContext?.projectsWithMetadata) {
    const projectId = viewKey.replace("view:project:", "")
    const project = viewContext.projectsWithMetadata.find(p => p.todoist_id === projectId)
    if (project) {
      icon = <ProjectColorIndicator project={project} size="md" className="mr-1" />
    }
  } else if (viewKey.startsWith("view:routines:project:") && viewContext?.projectsWithMetadata) {
    // For routine project views, pass project color to getViewIcon
    const projectId = viewKey.replace("view:routines:project:", "")
    const project = viewContext.projectsWithMetadata.find(p => p.todoist_id === projectId)
    if (project) {
      icon = getViewIcon(viewKey, { size: "sm", color: project.color })
    }
  }

  // Fallback to default icon if not set
  if (!icon) {
    icon = getViewIcon(viewKey, { size: "sm" })
  }

  // 3. Get count from CountRegistry
  // For collapsed parent projects, include descendant counts
  const { getCountForView } = useCountRegistry()
  const includeDescendants = hasChildren && isCollapsed
  const count = viewContext ? getCountForView(viewKey, viewContext, includeDescendants) : null

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
        sortConfig={sortConfig}
      />
    </SidebarMenuItem>
  )
}
