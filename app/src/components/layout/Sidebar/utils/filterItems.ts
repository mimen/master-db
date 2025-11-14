import { Flag } from "lucide-react"
import type { ComponentType } from "react"

import type { ViewKey } from "@/lib/views/types"

/**
 * Time filter item for sidebar and command palette
 */
export type TimeFilterItem = {
  id: string
  label: string
  filterKey: string
  viewKey: ViewKey
}

/**
 * Priority filter item for sidebar and command palette
 */
export type PriorityFilterItem = {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  priorityLevel: number
  viewKey: ViewKey
}

/**
 * Static time filter items
 */
export const TIME_FILTER_ITEMS: TimeFilterItem[] = [
  {
    id: "overdue",
    label: "Overdue",
    filterKey: "overdue",
    viewKey: "view:time:overdue",
  },
  {
    id: "today",
    label: "Today",
    filterKey: "today",
    viewKey: "view:time:today",
  },
  {
    id: "upcoming",
    label: "Upcoming",
    filterKey: "next7days",
    viewKey: "view:time:upcoming",
  },
  {
    id: "no-date",
    label: "No Date",
    filterKey: "nodate",
    viewKey: "view:time:no-date",
  },
]

/**
 * Static priority filter items (task mode)
 */
export const PRIORITY_FILTER_ITEMS: PriorityFilterItem[] = [
  {
    id: "p1",
    label: "Priority 1",
    icon: Flag,
    priorityLevel: 4,
    viewKey: "view:priority:p1",
  },
  {
    id: "p2",
    label: "Priority 2",
    icon: Flag,
    priorityLevel: 3,
    viewKey: "view:priority:p2",
  },
  {
    id: "p3",
    label: "Priority 3",
    icon: Flag,
    priorityLevel: 2,
    viewKey: "view:priority:p3",
  },
  {
    id: "p4",
    label: "Priority 4",
    icon: Flag,
    priorityLevel: 1,
    viewKey: "view:priority:p4",
  },
]

/**
 * Static priority-projects filter items (project mode)
 */
export const PRIORITY_PROJECTS_ITEMS: PriorityFilterItem[] = [
  {
    id: "p1-projects",
    label: "P1 Projects",
    icon: Flag,
    priorityLevel: 4,
    viewKey: "view:priority-projects:p1",
  },
  {
    id: "p2-projects",
    label: "P2 Projects",
    icon: Flag,
    priorityLevel: 3,
    viewKey: "view:priority-projects:p2",
  },
  {
    id: "p3-projects",
    label: "P3 Projects",
    icon: Flag,
    priorityLevel: 2,
    viewKey: "view:priority-projects:p3",
  },
  {
    id: "p4-projects",
    label: "P4 Projects",
    icon: Flag,
    priorityLevel: 1,
    viewKey: "view:priority-projects:p4",
  },
]
