import type { ComponentType } from "react"

import type { ViewKey, ViewSelection, ViewBuildContext } from "@/lib/views/types"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

export type ProjectTreeNode = TodoistProjectWithMetadata & {
  children: ProjectTreeNode[]
  level?: number
  isLastInGroup?: boolean
}

export type ProjectSort = "hierarchy" | "priority" | "taskCount" | "alphabetical"
export type LabelSort = "taskCount" | "alphabetical"
export type RoutineSort = "flat" | "projectOrder" | "routineCount"

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
