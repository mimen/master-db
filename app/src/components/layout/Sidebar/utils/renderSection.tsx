import { ArrowDownAZ, Flag, Hash, Network } from "lucide-react"
import { Fragment } from "react"
import type { ReactNode } from "react"
import type { ElementType } from "react"

import { CollapseCaret } from "../components/CollapseCaret"
import { SortDropdown } from "../components/SortDropdown"
import { ViewItem } from "../components/ViewItem"
import { SIDEBAR_CONFIG } from "../config/sidebarConfig"
import type { SidebarSection, SortOption, SubviewDefinition } from "../config/types"

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
  // Old collapse functions (kept for backward compatibility during transition)
  isPriorityGroupCollapsed: (priority: number) => boolean
  togglePriorityGroupCollapse: (priority: number) => void
  isProjectCollapsed: (projectId: string) => boolean
  toggleProjectCollapse: (projectId: string) => void
  // NEW: Unified section-scoped collapse
  isViewCollapsed: (viewKey: ViewKey, section: string) => boolean
  toggleViewCollapse: (viewKey: ViewKey, section: string) => void
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
    case "routineCount":
      return Hash
    case "alphabetical":
    case "flat":
      return ArrowDownAZ
    case "projectOrder":
      return Network
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
  let staticItems: ViewKey[] = []
  let dynamicItems: ViewKey[] = []
  let sortConfig: {
    modes: readonly string[]
    currentMode: string
    getIcon: (mode: string) => ElementType<{ className?: string }>
    onChange: (mode: string) => void
  } | null = null

  // Handle static items (always shown, e.g., folder type views)
  if (items) {
    staticItems = items
  }

  // Handle dynamic items (with sorting, e.g., projects list)
  if (sortOptions) {
    // Section with sorting - get current sort mode
    const currentSort = props.sortMode[sectionKey] || sortOptions[0].key
    const currentSortOption = sortOptions.find((opt) => opt.key === currentSort)!

    // Resolve items based on current sort
    if ("items" in currentSortOption) {
      dynamicItems = currentSortOption.items
    } else {
      dynamicItems = resolveGenerator(
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

  // Combine static and dynamic items (static items appear first)
  const sectionItems = [...staticItems, ...dynamicItems]

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
            {sectionItems.map((viewKey) => renderViewItem(viewKey, props, 0, sectionKey))}
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
 * Map view-key to sort mode key for views that support sorting
 * Returns the key used in sortMode object (e.g., "folders", "routines")
 */
function getViewSortKey(viewKey: ViewKey): string | null {
  if (viewKey === "view:folders") return "folders"
  if (viewKey === "view:routines") return "routines"
  return null
}

/**
 * Get children for a project from the project tree (for hierarchy mode)
 */
function getProjectChildren(projectId: string, viewContext: ViewBuildContext): ViewKey[] {
  const projectTree = viewContext.projectTree || []

  // Find the project in the tree (could be at any level)
  function findProject(nodes: any[]): any {
    for (const node of nodes) {
      if (node.todoist_id === projectId) {
        return node
      }
      if (node.children && node.children.length > 0) {
        const found = findProject(node.children)
        if (found) return found
      }
    }
    return null
  }

  const project = findProject(projectTree)
  if (project && project.children && project.children.length > 0) {
    return project.children.map((child: any) => `view:project:${child.todoist_id}` as ViewKey)
  }

  return []
}

/**
 * Recursively render a view item with potential subviews
 */
export function renderViewItem(
  viewKey: ViewKey,
  props: CommonSectionProps,
  level: number = 0,
  section: string = "default"
): ReactNode {
  // Check if this view has subviews (either static or dynamic)
  const subviewDef = SIDEBAR_CONFIG.subviews[viewKey]

  // For project views, also check for dynamic hierarchy children
  let children: ViewKey[] = []
  let hasChildren = false
  let sortConfig: {
    modes: readonly string[]
    currentMode: string
    getIcon: (mode: string) => ElementType<{ className?: string }>
    onChange: (mode: string) => void
  } | null = null

  if (subviewDef) {
    // Check if this subview has sortOptions
    const viewSortKey = getViewSortKey(viewKey)
    let currentSort: string | undefined

    if (subviewDef.sortOptions && viewSortKey) {
      // Get current sort mode for this view
      currentSort = props.sortMode[viewSortKey] || subviewDef.sortOptions[0].key

      // Build sort dropdown config
      sortConfig = {
        modes: subviewDef.sortOptions.map((opt) => opt.key) as readonly string[],
        currentMode: currentSort,
        onChange: (mode: string) => props.setSortMode(viewSortKey, mode),
        getIcon: getSortIcon,
      }
    }

    // Resolve children with current sort mode
    children = resolveSubview(subviewDef, props.viewContext, props.getCountForView, currentSort)
    hasChildren = children.length > 0
  } else if (viewKey.startsWith("view:project:")) {
    // Dynamic hierarchy children for projects - ONLY in hierarchy mode
    const currentSort = props.sortMode["folders"]
    const isHierarchyMode = currentSort === "hierarchy"

    if (isHierarchyMode) {
      const projectId = viewKey.replace("view:project:", "")
      children = getProjectChildren(projectId, props.viewContext)
      hasChildren = children.length > 0
    }
  }

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
  let isCollapsed = false
  let onToggleCollapse = () => {}

  if (viewKey === "view:multi:priority-queue") {
    // Priority queue uses section collapse (special case)
    isCollapsed = props.collapsed.priorityQueue ?? false
    onToggleCollapse = () => props.toggleSection("priorityQueue")
  } else {
    // NEW: All other expandable views use unified section-scoped collapse
    isCollapsed = props.isViewCollapsed(viewKey, section)
    onToggleCollapse = () => props.toggleViewCollapse(viewKey, section)
  }

  return (
    <Fragment key={viewKey}>
      <ViewItem
        key={viewKey}
        viewKey={viewKey}
        level={level}
        hasChildren={true}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
        currentViewKey={props.currentViewKey}
        onViewChange={props.onViewChange}
        viewContext={props.viewContext}
        sortConfig={sortConfig || undefined}
      />
      {!isCollapsed &&
        children.map((child) => {
          // Special case: Priority Queue creates its own section context
          const childSection = viewKey === "view:multi:priority-queue" ? "priorityQueue" : section
          return renderViewItem(child, props, level + 1, childSection)
        })}
    </Fragment>
  )
}

/**
 * Resolve a subview definition to an array of view-keys
 * Handles both static items and sortable items
 */
export function resolveSubview(
  def: SubviewDefinition,
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number,
  currentSort?: string
): ViewKey[] {
  let staticItems: ViewKey[] = []
  let dynamicItems: ViewKey[] = []

  // Handle static items (always shown)
  if (def.items) {
    staticItems = def.items
  }

  // Handle sortable items
  if (def.sortOptions && currentSort) {
    const currentSortOption = def.sortOptions.find((opt) => opt.key === currentSort)
    if (currentSortOption) {
      if ("items" in currentSortOption) {
        dynamicItems = currentSortOption.items
      } else {
        dynamicItems = resolveGenerator(
          currentSortOption.source,
          {},
          viewContext,
          getCountForView
        )
      }
    }
  } else if (def.sortOptions) {
    // Default to first sort option if no current sort specified
    const firstOption = def.sortOptions[0]
    if ("items" in firstOption) {
      dynamicItems = firstOption.items
    } else {
      dynamicItems = resolveGenerator(firstOption.source, {}, viewContext, getCountForView)
    }
  }

  // Legacy generator support
  if (def.type === "generator" && def.source && !def.sortOptions) {
    return resolveGenerator(def.source, def.params || {}, viewContext, getCountForView)
  }

  // Combine static and dynamic items (static items appear first)
  return [...staticItems, ...dynamicItems]
}
