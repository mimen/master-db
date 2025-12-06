import type { ComponentType } from "react"

import type { ViewKey, ViewSelection, ViewBuildContext, ProjectTreeNode } from "@/lib/views/types"

export type ProjectSort = "hierarchy" | "priority" | "taskCount" | "alphabetical"
export type LabelSort = "taskCount" | "alphabetical"
export type RoutineSort = "flat" | "projectOrder" | "routineCount"

/**
 * Composite key format for tracking collapsed views by section.
 *
 * Format: "{section}:{viewKey}"
 *
 * Examples:
 * - "folders:view:priority-projects:p1"
 * - "priorityQueue:view:priority-projects:p1"
 * - "folders:view:project:abc123"
 *
 * This allows the same view to have independent collapse states
 * when it appears in different sections.
 */
export type CollapsedViewKey = `${string}:${string}`

export type ViewNavItem = {
  key: ViewKey
  label: string
  icon: ComponentType<{ className?: string }>
  count?: number | null
}

export interface RoutinesSectionProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  viewContext: ViewBuildContext
  isCollapsed: boolean
  onToggleCollapse: () => void
  sortMode: RoutineSort
  onSortChange: (sort: RoutineSort) => void
}
