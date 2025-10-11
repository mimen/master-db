import type { ProjectSort, LabelSort, ProjectTreeNode } from "../types"

import { flattenProjects } from "./projectTree"

import type { TodoistLabelDoc } from "@/types/convex/todoist"

/**
 * Sorts projects based on the selected sort mode
 */
export function getSortedProjects(
  projects: ProjectTreeNode[],
  sortMode: ProjectSort
): ProjectTreeNode[] {
  if (!projects) return []

  switch (sortMode) {
    case "hierarchy":
      return projects
    case "priority": {
      const flat = flattenProjects(projects)
      return flat.sort((a, b) => {
        const priorityA = a.metadata?.priority || 1
        const priorityB = b.metadata?.priority || 1
        return priorityB - priorityA
      })
    }
    case "taskCount": {
      const flat = flattenProjects(projects)
      return flat.sort((a, b) => b.stats.activeCount - a.stats.activeCount)
    }
    case "alphabetical": {
      const flat = flattenProjects(projects)
      return flat.sort((a, b) => a.name.localeCompare(b.name))
    }
    default:
      return projects
  }
}

/**
 * Sorts labels based on the selected sort mode
 */
export function getSortedLabels(
  labels: TodoistLabelDoc[] | undefined,
  sortMode: LabelSort,
  labelCounts?: { labelCounts: { labelId: string; filteredTaskCount: number }[] }
): TodoistLabelDoc[] {
  if (!labels) return []

  switch (sortMode) {
    case "taskCount":
      return [...labels].sort((a, b) => {
        const countA =
          labelCounts?.labelCounts.find((c) => c.labelId === a.todoist_id)?.filteredTaskCount || 0
        const countB =
          labelCounts?.labelCounts.find((c) => c.labelId === b.todoist_id)?.filteredTaskCount || 0
        return countB - countA
      })
    case "alphabetical":
      return [...labels].sort((a, b) => a.name.localeCompare(b.name))
    default:
      return labels
  }
}
