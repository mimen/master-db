import type { ReactNode } from "react"
import { Fragment } from "react"
import { ArrowDownAZ, Flag, Hash, Network } from "lucide-react"
import type { ElementType } from "react"

import type { SidebarSection, SortOption, SubviewDefinition } from "../config/types"
import { SIDEBAR_CONFIG } from "../config/sidebarConfig"
import { CollapseCaret } from "../components/CollapseCaret"
import { SortDropdown } from "../components/SortDropdown"
import { ViewItem } from "../components/ViewItem"

import { resolveGenerator } from "./generators"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"

/**
 * Common props needed for rendering sections and items
 */
interface CommonSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  collapsed: Record<string, boolean>
  toggleSection: (section: string) => void
  sortMode: Record<string, string>
  setSortMode: (section: string, mode: string) => void
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
  isPriorityGroupCollapsed: (priority: number) => boolean
  togglePriorityGroupCollapse: (priority: number) => void
  isProjectCollapsed: (projectId: string) => boolean
  toggleProjectCollapse: (projectId: string) => void
}

/**
 * Get icon component for a sort mode key
 * Maps sort mode strings to their corresponding Lucide icon components
 */
function getSortIcon(mode: string): ElementType<{ className?: string }> {
  switch (mode) {
    case "hierarchy":
      return Network
    case "priority":
      return Flag
    case "taskCount":
      return Hash
    case "alphabetical":
      return ArrowDownAZ
    default:
      return Hash // Default fallback
  }
}

/**
 * Render a complete sidebar section with header, sorting, and items
 */
export function renderSection(
  section: SidebarSection,
  props: CommonSectionProps
): ReactNode {
  const { section: sectionKey, label, items, sortOptions } = section

  // Get collapse state for this section
  const isCollapsed = props.collapsed[sectionKey] ?? false
  const toggleCollapse = () => props.toggleSection(sectionKey)

  // Determine what to render
  let sectionItems: ViewKey[] = []
  let sortConfig: {
    modes: readonly string[]
    currentMode: string
    getIcon: (mode: string) => ElementType<{ className?: string }>
    onChange: (mode: string) => void
  } | null = null

  if (items) {
    // Simple static list
    sectionItems = items
  } else if (sortOptions) {
    // Section with sorting - get current sort mode
    const currentSort = props.sortMode[sectionKey] || sortOptions[0].key
    const currentSortOption = sortOptions.find((opt) => opt.key === currentSort)!

    // Resolve items based on current sort
    if ("items" in currentSortOption) {
      sectionItems = currentSortOption.items
    } else {
      sectionItems = resolveGenerator(
        currentSortOption.source,
        {},
        props.viewContext,
        props.getCountForView
      )
    }

    // Build sort dropdown config
    sortConfig = {
      modes: sortOptions.map((opt) => opt.key) as readonly string[],
      currentMode: currentSort,
      onChange: (mode: string) => props.setSortMode(sectionKey, mode),
      getIcon: getSortIcon,
    }
  }

  // Render section
  return (
    <Collapsible key={sectionKey} open={!isCollapsed} onOpenChange={toggleCollapse}>
      <SidebarGroup>
        {label && (
          <div className="flex items-center justify-between">
            <SidebarGroupLabel className="flex-1">{label}</SidebarGroupLabel>
            <div className="flex items-center pr-2">
              {sortConfig && <SortDropdown {...sortConfig} />}
              <CollapsibleTrigger asChild>
                <CollapseCaret
                  isCollapsed={isCollapsed}
                  onToggle={(e) => {
                    e.preventDefault()
                    toggleCollapse()
                  }}
                />
              </CollapsibleTrigger>
            </div>
          </div>
        )}

        <CollapsibleContent>
          <SidebarMenu className="space-y-0.5">
            {sectionItems.map((viewKey) => renderViewItem(viewKey, props, 0))}
            {sectionItems.length === 0 && label && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No {label.toLowerCase()} found
              </p>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

/**
 * Recursively render a view item with potential subviews
 */
export function renderViewItem(
  viewKey: ViewKey,
  props: CommonSectionProps,
  level: number = 0
): ReactNode {
  // Check if this view has subviews
  const subviewDef = SIDEBAR_CONFIG.subviews[viewKey]
  const hasChildren = !!subviewDef

  if (!hasChildren) {
    // Simple leaf item
    return (
      <ViewItem
        key={viewKey}
        viewKey={viewKey}
        level={level}
        currentViewKey={props.currentViewKey}
        onViewChange={props.onViewChange}
        viewContext={props.viewContext}
      />
    )
  }

  // Item with children - determine collapse state
  // Priority-projects use priority group collapse, others use a generic mechanism
  let isCollapsed = false
  let onToggleCollapse = () => {}

  if (viewKey.startsWith("view:priority-projects:")) {
    // Extract priority from view-key
    const priorityStr = viewKey.replace("view:priority-projects:", "")
    const priorityMap: Record<string, number> = { p1: 4, p2: 3, p3: 2, p4: 1 }
    const priority = priorityMap[priorityStr]
    if (priority) {
      isCollapsed = props.isPriorityGroupCollapsed(priority)
      onToggleCollapse = () => props.togglePriorityGroupCollapse(priority)
    }
  } else if (viewKey === "view:multi:priority-queue") {
    // Priority queue uses its own collapse state
    isCollapsed = props.collapsed.priorityQueue ?? false
    onToggleCollapse = () => props.toggleSection("priorityQueue")
  }

  // Resolve children
  const children = resolveSubview(subviewDef, props.viewContext, props.getCountForView)

  return (
    <Fragment key={viewKey}>
      <ViewItem
        viewKey={viewKey}
        level={level}
        hasChildren={true}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        currentViewKey={props.currentViewKey}
        onViewChange={props.onViewChange}
        viewContext={props.viewContext}
      />
      {!isCollapsed && children.map((child) => renderViewItem(child, props, level + 1))}
    </Fragment>
  )
}

/**
 * Resolve a subview definition to an array of view-keys
 */
export function resolveSubview(
  def: SubviewDefinition,
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
): ViewKey[] {
  if (def.items) {
    return def.items
  }

  if (def.type === "generator" && def.source) {
    return resolveGenerator(def.source, def.params || {}, viewContext, getCountForView)
  }

  return []
}
