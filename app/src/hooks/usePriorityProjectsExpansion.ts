import { useQuery } from "convex/react"
import { useMemo } from "react"

import { api } from "@/convex/_generated/api"
import type { ViewConfig } from "@/types/views"

/**
 * Hook to expand priority-projects view into individual project views
 *
 * Takes a view like "priority-projects:p1" and expands it into
 * multiple project views, one for each project with that priority
 */
export function usePriorityProjectsExpansion(view: string): ViewConfig[] | null {
  // Parse priority level from view
  const priorityLevel = useMemo(() => {
    if (!view.startsWith("priority-projects:")) return null

    const priorityId = view.split(":")[1]
    return priorityId === "p1" ? 4 :
           priorityId === "p2" ? 3 :
           priorityId === "p3" ? 2 : 1
  }, [view])

  // Fetch projects with this priority
  const projects = useQuery(
    api.todoist.publicQueries.getProjectsByPriority,
    priorityLevel !== null ? { priority: priorityLevel } : "skip"
  )

  console.log('[usePriorityProjectsExpansion] view:', view, 'priorityLevel:', priorityLevel, 'projects:', projects)

  // Expand to view configs
  return useMemo(() => {
    // If not a priority-projects view, return empty array immediately
    if (priorityLevel === null) {
      console.log('[usePriorityProjectsExpansion] Not a priority-projects view, returning []')
      return []
    }

    // Only return null if we haven't loaded yet
    if (projects === undefined) {
      console.log('[usePriorityProjectsExpansion] Still loading, returning null')
      return null
    }

    // If no projects found, return empty array
    if (projects.length === 0) {
      console.log('[usePriorityProjectsExpansion] No projects found, returning []')
      return []
    }

    const viewConfigs = projects.map((project) => ({
      id: `project-${project.todoist_id}`,
      type: "project" as const,
      value: `project:${project.todoist_id}`,
      title: project.name,
      collapsible: true,
      expanded: true,
    }))

    console.log('[usePriorityProjectsExpansion] Returning view configs:', viewConfigs)
    return viewConfigs
  }, [projects, priorityLevel])
}
