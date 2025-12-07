import type { ViewBuildContext, ViewKey, ProjectTreeNode } from "@/lib/views/types"

/**
 * Resolves a generator source to an array of view-keys
 *
 * @param source - Generator source name
 * @param params - Generator parameters
 * @param viewContext - View build context with data
 * @param getCountForView - Function to get count for a view (for sorting by count)
 * @returns Array of view-keys
 */
export function resolveGenerator(
  source: string,
  params: Record<string, any>,
  viewContext: ViewBuildContext,
  getCountForView?: (viewKey: ViewKey, ctx: ViewBuildContext) => number
): ViewKey[] {
  switch (source) {
    case "projectsByPriority":
      return generateProjectsByPriority(params.priority, viewContext)

    case "projectsByHierarchy":
      return generateProjectsByHierarchy(viewContext)

    case "projectsByTaskCount":
      return generateProjectsByTaskCount(viewContext)

    case "projectsByAlphabetical":
      return generateProjectsByAlphabetical(viewContext)

    case "labelsByTaskCount":
      if (!getCountForView) {
        throw new Error("labelsByTaskCount requires getCountForView function")
      }
      return generateLabelsByTaskCount(viewContext, getCountForView)

    case "labelsByAlphabetical":
      return generateLabelsByAlphabetical(viewContext)

    case "routinesByFlat":
      if (!getCountForView) {
        throw new Error("routinesByFlat requires getCountForView function")
      }
      return generateRoutinesByFlat(viewContext, getCountForView)

    case "routinesByProjectOrder":
      if (!getCountForView) {
        throw new Error("routinesByProjectOrder requires getCountForView function")
      }
      return generateRoutinesByProjectOrder(viewContext, getCountForView)

    case "routinesByCount":
      if (!getCountForView) {
        throw new Error("routinesByCount requires getCountForView function")
      }
      return generateRoutinesByCount(viewContext, getCountForView)

    default:
      console.warn(`Unknown generator source: ${source}`)
      return []
  }
}

/**
 * Generate projects filtered by priority
 */
function generateProjectsByPriority(
  priority: number,
  viewContext: ViewBuildContext
): ViewKey[] {
  return (viewContext.projectsWithMetadata || [])
    .filter((p) => (p.metadata?.priority || 1) === priority)
    .map((p) => `view:project:${p.todoist_id}` as ViewKey)
}

/**
 * Generate projects in hierarchy order (only root-level projects)
 * Children are handled via dynamic subview resolution
 */
function generateProjectsByHierarchy(viewContext: ViewBuildContext): ViewKey[] {
  const projectTree = viewContext.projectTree || []

  // Only return root-level projects
  // Children will be rendered via the subview system
  return projectTree.map((node) => `view:project:${node.todoist_id}` as ViewKey)
}

/**
 * Generate projects sorted by task count (descending)
 */
function generateProjectsByTaskCount(viewContext: ViewBuildContext): ViewKey[] {
  return (viewContext.projectsWithMetadata || [])
    .slice() // Create copy to avoid mutating original
    .sort((a, b) => b.stats.activeCount - a.stats.activeCount)
    .map((p) => `view:project:${p.todoist_id}` as ViewKey)
}

/**
 * Generate projects sorted alphabetically
 */
function generateProjectsByAlphabetical(viewContext: ViewBuildContext): ViewKey[] {
  return (viewContext.projectsWithMetadata || [])
    .slice() // Create copy to avoid mutating original
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `view:project:${p.todoist_id}` as ViewKey)
}

/**
 * Generate labels sorted by task count (descending)
 */
function generateLabelsByTaskCount(
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
): ViewKey[] {
  return (viewContext.labels || [])
    .map((label) => ({
      label,
      count: getCountForView(`view:label:${label.name}` as ViewKey, viewContext),
    }))
    .sort((a, b) => b.count - a.count)
    .map((item) => `view:label:${item.label.name}` as ViewKey)
}

/**
 * Generate labels sorted alphabetically
 */
function generateLabelsByAlphabetical(viewContext: ViewBuildContext): ViewKey[] {
  return (viewContext.labels || [])
    .slice() // Create copy to avoid mutating original
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((l) => `view:label:${l.name}` as ViewKey)
}

/**
 * Get all projects that have active routines
 */
function getProjectsWithRoutines(
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
) {
  const projects = viewContext.projectsWithMetadata || []

  return projects.filter((project) => {
    const viewKey = `view:routines:project:${project.todoist_id}` as ViewKey
    const count = getCountForView(viewKey, viewContext)
    return count > 0
  })
}

/**
 * Flatten project tree while preserving hierarchy order
 */
function flattenProjectTree(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  const result: ProjectTreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children && node.children.length > 0) {
      result.push(...flattenProjectTree(node.children))
    }
  }
  return result
}

/**
 * Build project tree from flat list of projects
 */
function buildProjectTree(projects: any[]): ProjectTreeNode[] {
  // Find root projects (no parent)
  const roots = projects.filter((p) => !p.parent_id)

  // Recursive function to build tree
  function buildNode(project: any): ProjectTreeNode {
    const children = projects
      .filter((p) => p.parent_id === project.todoist_id)
      .sort((a, b) => a.child_order - b.child_order)
      .map(buildNode)

    return {
      ...project,
      children,
    }
  }

  return roots.sort((a, b) => a.child_order - b.child_order).map(buildNode)
}

/**
 * Generate routine projects sorted alphabetically
 */
function generateRoutinesByFlat(
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
): ViewKey[] {
  const projectsWithRoutines = getProjectsWithRoutines(viewContext, getCountForView)
  return projectsWithRoutines
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `view:routines:project:${p.todoist_id}` as ViewKey)
}

/**
 * Generate routine projects in hierarchical order (flattened)
 */
function generateRoutinesByProjectOrder(
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
): ViewKey[] {
  const projectsWithRoutines = getProjectsWithRoutines(viewContext, getCountForView)
  const tree = buildProjectTree(projectsWithRoutines)
  const flattened = flattenProjectTree(tree)
  return flattened.map((node) => `view:routines:project:${node.todoist_id}` as ViewKey)
}

/**
 * Generate routine projects sorted by active routine count (descending)
 */
function generateRoutinesByCount(
  viewContext: ViewBuildContext,
  getCountForView: (viewKey: ViewKey, ctx: ViewBuildContext) => number
): ViewKey[] {
  const projectsWithRoutines = getProjectsWithRoutines(viewContext, getCountForView)

  const projectsWithCounts = projectsWithRoutines.map((project) => {
    const viewKey = `view:routines:project:${project.todoist_id}` as ViewKey
    const count = getCountForView(viewKey, viewContext)
    return { project, count }
  })

  return projectsWithCounts
    .sort((a, b) => b.count - a.count)
    .map((item) => `view:routines:project:${item.project.todoist_id}` as ViewKey)
}
