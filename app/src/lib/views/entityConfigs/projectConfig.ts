import type { SortOption, GroupOption } from "@/lib/views/types"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

/**
 * Sort options for projects
 */
export const projectSortOptions: SortOption<TodoistProjectWithMetadata>[] = [
  {
    id: "az",
    label: "A-Z",
    compareFn: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: "priority",
    label: "Priority",
    compareFn: (a, b) => {
      // Invert: higher API number = higher UI priority
      const aPriority = a.metadata?.priority ?? 1
      const bPriority = b.metadata?.priority ?? 1
      return bPriority - aPriority
    },
  },
  {
    id: "task-count",
    label: "Task Count",
    compareFn: (a, b) => (b.metadata?.taskCount ?? 0) - (a.metadata?.taskCount ?? 0),
  },
]

/**
 * Group options for projects
 */
export const projectGroupOptions: GroupOption<TodoistProjectWithMetadata>[] = [
  {
    id: "parent",
    label: "Parent Project",
    groupFn: (project) => project.parent_id ?? "root",
    getGroupLabel: (projectId, groupData) => {
      if (projectId === "root") {
        return "Top Level"
      }
      const projects = groupData.projects as any[]
      const project = projects?.find((p) => p.id === projectId)
      return project?.name ?? "Unknown Parent"
    },
  },
]
