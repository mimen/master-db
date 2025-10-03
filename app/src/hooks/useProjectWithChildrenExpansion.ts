import { useQuery } from "convex/react"
import { useMemo } from "react"

import { api } from "@/convex/_generated/api"
import type { ViewConfig } from "@/types/views"

/**
 * Hook to expand project-with-children view into parent + children views
 *
 * Takes a view like "project-with-children:123" and expands it into
 * the parent project view followed by all its children
 */
export function useProjectWithChildrenExpansion(view: string): ViewConfig[] | null {
  // Parse project ID from view
  const projectId = useMemo(() => {
    if (!view.startsWith("project-with-children:")) return null
    return view.split(":")[1]
  }, [view])

  // Fetch all projects to find children
  const allProjects = useQuery(api.todoist.publicQueries.getProjects)

  // Expand to view configs
  return useMemo(() => {
    if (!allProjects || !projectId) return null

    const parentProject = allProjects.find((p) => p.todoist_id === projectId)
    if (!parentProject) return null

    const children = allProjects
      .filter((p) => p.parent_id === projectId)
      .sort((a, b) => a.child_order - b.child_order)

    const views: ViewConfig[] = [
      {
        id: `project-${parentProject.todoist_id}`,
        type: "project" as const,
        value: `project:${parentProject.todoist_id}`,
        title: parentProject.name,
        collapsible: true,
        expanded: true,
      },
      ...children.map((child) => ({
        id: `project-${child.todoist_id}`,
        type: "project" as const,
        value: `project:${child.todoist_id}`,
        title: child.name,
        collapsible: true,
        expanded: true,
      })),
    ]

    return views
  }, [allProjects, projectId])
}
