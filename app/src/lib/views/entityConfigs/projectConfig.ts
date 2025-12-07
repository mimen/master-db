import type { SortOption, GroupOption } from "@/lib/views/types"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

/**
 * Helper to wrap sort functions with archived-at-bottom behavior
 */
function withArchivedAtBottom(
  compareFn: (a: TodoistProjectWithMetadata, b: TodoistProjectWithMetadata) => number
) {
  return (a: TodoistProjectWithMetadata, b: TodoistProjectWithMetadata) => {
    // Always keep archived projects at the bottom
    if (a.is_archived !== b.is_archived) {
      return a.is_archived ? 1 : -1
    }
    return compareFn(a, b)
  }
}

/**
 * Sort options for projects
 */
export const projectSortOptions: SortOption<TodoistProjectWithMetadata>[] = [
  {
    id: "az",
    label: "A-Z",
    compareFn: withArchivedAtBottom((a, b) => a.name.localeCompare(b.name)),
  },
  {
    id: "priority",
    label: "Priority",
    compareFn: withArchivedAtBottom((a, b) => {
      // Invert: higher API number = higher UI priority
      const aPriority = a.metadata?.priority ?? 1
      const bPriority = b.metadata?.priority ?? 1
      return bPriority - aPriority
    }),
  },
  {
    id: "task-count",
    label: "Task Count",
    compareFn: withArchivedAtBottom(
      (a, b) => (b.stats?.activeCount ?? 0) - (a.stats?.activeCount ?? 0)
    ),
  },
]

/**
 * Group options for projects
 */
export const projectGroupOptions: GroupOption<TodoistProjectWithMetadata>[] = [
  {
    id: "parent",
    label: "Hierarchy",
    groupFn: (project) => project.parent_id ?? "root",
    getGroupLabel: (projectId, groupData) => {
      if (projectId === "root") {
        return "Top Level"
      }
      const projects = groupData.projects as TodoistProjectWithMetadata[]
      const project = projects?.find((p) => p.todoist_id === projectId || p.id === projectId)
      // Note: If project not found, it's likely archived. Show a helpful message.
      return project?.name ?? `${projectId} (archived or deleted)`
    },
  },
]
