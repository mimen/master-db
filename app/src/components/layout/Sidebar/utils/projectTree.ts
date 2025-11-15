import type { ProjectTreeNode } from "../types"

import type { TodoistProjectsWithMetadata } from "@/types/convex/todoist"

/**
 * Builds a hierarchical tree structure from flat project list
 */
export function buildProjectTree(projects: TodoistProjectsWithMetadata): ProjectTreeNode[] {
  const projectMap = new Map<string, ProjectTreeNode>()
  const rootProjects: ProjectTreeNode[] = []

  projects.forEach((project) => {
    projectMap.set(project.todoist_id, { ...project, children: [] })
  })

  projects.forEach((project) => {
    const projectWithChildren = projectMap.get(project.todoist_id)!
    if (project.parent_id && projectMap.has(project.parent_id)) {
      projectMap.get(project.parent_id)!.children.push(projectWithChildren)
    } else {
      rootProjects.push(projectWithChildren)
    }
  })

  const sortProjects = (nodes: ProjectTreeNode[]) => {
    nodes.sort((a, b) => a.child_order - b.child_order)
    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortProjects(node.children)
      }
    })
  }

  sortProjects(rootProjects)
  return rootProjects
}

/**
 * Flattens a project tree into a single-level array, preserving DnD metadata
 */
export function flattenProjects(projects: ProjectTreeNode[]): ProjectTreeNode[] {
  const result: ProjectTreeNode[] = []

  function flatten(nodes: ProjectTreeNode[]) {
    for (const node of nodes) {
      result.push({
        ...node,
        children: [],
        level: node.level,
        isLastInGroup: node.isLastInGroup,
      })
      if (node.children.length > 0) {
        flatten(node.children)
      }
    }
  }

  flatten(projects)
  return result
}

/**
 * Calculates total active task count for a project and all its descendants
 */
export function getTotalActiveCount(project: ProjectTreeNode): number {
  let total = project.stats.activeCount

  for (const child of project.children) {
    total += getTotalActiveCount(child)
  }

  return total
}

/**
 * Enriches tree nodes with level and isLastInGroup properties for DnD
 */
export function enrichTreeWithDnDMetadata(nodes: ProjectTreeNode[], parentLevel = 0): ProjectTreeNode[] {
  return nodes.map((node, index) => {
    const enrichedNode: ProjectTreeNode = {
      ...node,
      level: parentLevel,
      isLastInGroup: index === nodes.length - 1,
      children: enrichTreeWithDnDMetadata(node.children, parentLevel + 1),
    }
    return enrichedNode
  })
}
