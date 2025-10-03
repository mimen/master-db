import { useMemo } from "react"

import { usePriorityProjectsExpansion } from "./usePriorityProjectsExpansion"

import type { ViewConfig } from "@/types/views"

/**
 * Hook to expand priority queue multi-list
 *
 * Expands to: Overdue → Today → Inbox → P1 Tasks → P1 Projects → P2 Projects → Upcoming
 *
 * This is composable - it reuses the priority-projects expansion logic
 */
export function usePriorityQueueExpansion(shouldExpand: boolean): ViewConfig[] | null {
  // Reuse the priority-projects expansion logic
  const p1ProjectViews = usePriorityProjectsExpansion(shouldExpand ? "priority-projects:p1" : "")
  const p2ProjectViews = usePriorityProjectsExpansion(shouldExpand ? "priority-projects:p2" : "")

  console.log('[usePriorityQueueExpansion] shouldExpand:', shouldExpand)
  console.log('[usePriorityQueueExpansion] p1ProjectViews:', p1ProjectViews)
  console.log('[usePriorityQueueExpansion] p2ProjectViews:', p2ProjectViews)

  return useMemo(() => {
    if (!shouldExpand) return null

    // Wait for expansions to load (null means still loading, empty array means no projects)
    if (p1ProjectViews === null || p2ProjectViews === null) {
      console.log('[usePriorityQueueExpansion] Still loading...')
      return null
    }

    const views: ViewConfig[] = [
      { id: "overdue", type: "time", value: "time:overdue", collapsible: true, expanded: true },
      { id: "today", type: "today", value: "today", collapsible: true, expanded: true },
      { id: "inbox", type: "inbox", value: "inbox", collapsible: true, expanded: true },
      { id: "p1-tasks", type: "priority", value: "priority:p1", collapsible: true, expanded: true },
    ]

    // Add P1 Projects (reusing the expansion logic)
    console.log('[usePriorityQueueExpansion] Adding P1 projects:', p1ProjectViews.length)
    if (p1ProjectViews.length > 0) {
      views.push(...p1ProjectViews)
    }

    // Add P2 Projects (reusing the expansion logic)
    console.log('[usePriorityQueueExpansion] Adding P2 projects:', p2ProjectViews.length)
    if (p2ProjectViews.length > 0) {
      views.push(...p2ProjectViews)
    }

    // Add upcoming at the end
    views.push({
      id: "upcoming",
      type: "upcoming",
      value: "upcoming",
      collapsible: true,
      expanded: true,
    })

    console.log('[usePriorityQueueExpansion] Final views:', views.length, views)
    return views
  }, [shouldExpand, p1ProjectViews, p2ProjectViews])
}
