import type { ProjectTreeNode } from "../types"

import type { ViewBuildContext, ViewKey } from "@/lib/views/types"

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
 * Generate projects in hierarchy order (recursive tree traversal)
 * This preserves the project tree structure as view-keys
 */
function generateProjectsByHierarchy(viewContext: ViewBuildContext): ViewKey[] {
  const projectTree = viewContext.projectTree || []

  function traverseTree(nodes: ProjectTreeNode[]): ViewKey[] {
    const result: ViewKey[] = []
    for (const node of nodes) {
      result.push(`view:project:${node.todoist_id}` as ViewKey)
      if (node.children && node.children.length > 0) {
        result.push(...traverseTree(node.children))
      }
    }
    return result
  }

  return traverseTree(projectTree)
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
