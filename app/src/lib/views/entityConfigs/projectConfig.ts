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
 * Build hierarchy path for a project (for sorting in flattened hierarchy order)
 * Returns array of child_orders from root to this project
 */
function getHierarchyPath(
  project: TodoistProjectWithMetadata,
  projectMap: Map<string, TodoistProjectWithMetadata>
): number[] {
  const path: number[] = []
  let current: TodoistProjectWithMetadata | undefined = project

  while (current) {
    path.unshift(current.child_order)
    current = current.parent_id ? projectMap.get(current.parent_id) : undefined
  }

  return path
}

/**
 * Compare two hierarchy paths lexicographically
 */
function compareHierarchyPaths(pathA: number[], pathB: number[]): number {
  const minLen = Math.min(pathA.length, pathB.length)

  for (let i = 0; i < minLen; i++) {
    if (pathA[i] !== pathB[i]) {
      return pathA[i] - pathB[i]
    }
  }

  // Shorter path (parent) comes before longer path (child)
  return pathA.length - pathB.length
}

/**
 * Creates a hierarchy sort function that captures the project list
 * This enables proper flattened hierarchy ordering
 */
function createHierarchySortFn(
  projects: TodoistProjectWithMetadata[]
): (a: TodoistProjectWithMetadata, b: TodoistProjectWithMetadata) => number {
  // Build lookup map once
  const projectMap = new Map<string, TodoistProjectWithMetadata>()
  projects.forEach((p) => projectMap.set(p.todoist_id, p))

  // Cache paths for efficiency
  const pathCache = new Map<string, number[]>()
  const getPath = (p: TodoistProjectWithMetadata): number[] => {
    if (!pathCache.has(p.todoist_id)) {
      pathCache.set(p.todoist_id, getHierarchyPath(p, projectMap))
    }
    return pathCache.get(p.todoist_id)!
  }

  return withArchivedAtBottom((a, b) => {
    return compareHierarchyPaths(getPath(a), getPath(b))
  })
}

/**
 * Sort projects in flattened hierarchy order
 * Parents come before their children, siblings sorted by child_order
 */
export function sortProjectsByHierarchy(
  projects: TodoistProjectWithMetadata[]
): TodoistProjectWithMetadata[] {
  const sortFn = createHierarchySortFn(projects)
  return [...projects].sort(sortFn)
}

/**
 * Sort options for projects
 */
export const projectSortOptions: SortOption<TodoistProjectWithMetadata>[] = [
  {
    id: "default",
    label: "Default",
    // No-op: ProjectsListView pre-sorts using sortProjectsByHierarchy
    // This preserves the flattened hierarchy order
    compareFn: () => 0,
  },
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
    label: "Parent Project",
    groupFn: (project) => project.parent_id ?? "root",
    getGroupLabel: (projectId, groupData) => {
      if (projectId === "root") {
        return "Top Level"
      }
      const projects = groupData.projects as any[]
      const project = projects?.find((p) => p.todoist_id === projectId || p.id === projectId)
      // Note: If project not found, it's likely archived. Show a helpful message.
      return project?.name ?? `${projectId} (archived or deleted)`
    },
  },
]
