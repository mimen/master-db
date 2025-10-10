import type { ViewConfig } from "@/types/views"

/**
 * View Helper Utilities
 *
 * Pure functions to construct ViewConfig objects from view strings and data.
 * Replaces the reactive hooks pattern with direct function calls.
 */

// Type for project data needed by helpers
export interface ProjectData {
  todoist_id: string
  name: string
  parent_id?: string
  child_order: number
  metadata?: {
    priority?: number
  }
}

/**
 * Creates a single ViewConfig from a view string
 *
 * @example
 * createSingleView("inbox") → { id: "main", type: "inbox", value: "inbox", ... }
 * createSingleView("project:123") → { id: "main", type: "project", value: "project:123", ... }
 */
export function createSingleView(viewString: string): ViewConfig {
  const type = getViewType(viewString)

  return {
    id: "main",
    type,
    value: viewString,
    expanded: true,
    collapsible: false,
  }
}

/**
 * Determines the ViewConfig type from a view string
 */
function getViewType(view: string): ViewConfig["type"] {
  if (view === "inbox") return "inbox"
  if (view === "today") return "today"
  if (view === "upcoming") return "upcoming"
  if (view.startsWith("project:")) return "project"
  if (view.startsWith("time:")) return "time"
  if (view.startsWith("priority:")) return "priority"
  if (view.startsWith("label:")) return "label"
  return "inbox"
}

/**
 * Expands a priority-based project view into individual project views
 *
 * @example
 * expandPriorityProjects("p1", projects) → [{ type: "project", value: "project:123", ... }, ...]
 */
export function expandPriorityProjects(
  priorityId: string,
  projects: ProjectData[]
): ViewConfig[] {
  const priorityLevel =
    priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1

  const matchingProjects = projects.filter(
    (p) => p.metadata?.priority === priorityLevel
  )

  return matchingProjects.map((project) => ({
    id: `project-${project.todoist_id}`,
    type: "project" as const,
    value: `project:${project.todoist_id}`,
    title: project.name,
    collapsible: true,
    expanded: true,
  }))
}

/**
 * Expands a project-with-children view into parent + children views
 *
 * @example
 * expandProjectWithChildren("123", projects) → [parent, child1, child2, ...]
 */
export function expandProjectWithChildren(
  projectId: string,
  allProjects: ProjectData[]
): ViewConfig[] {
  const parentProject = allProjects.find((p) => p.todoist_id === projectId)
  if (!parentProject) return []

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
}

/**
 * Creates the priority queue multi-view
 *
 * Expands to: Overdue → Today → Inbox → P1 Tasks → P1 Projects → P2 Projects → Upcoming
 */
export function createPriorityQueueViews(projects: ProjectData[]): ViewConfig[] {
  const p1Projects = expandPriorityProjects("p1", projects)
  const p2Projects = expandPriorityProjects("p2", projects)

  const views: ViewConfig[] = [
    { id: "overdue", type: "time", value: "time:overdue", collapsible: true, expanded: true },
    { id: "today", type: "today", value: "today", collapsible: true, expanded: true },
    { id: "inbox", type: "inbox", value: "inbox", collapsible: true, expanded: true },
    { id: "p1-tasks", type: "priority", value: "priority:p1", collapsible: true, expanded: true },
  ]

  // Add P1 Projects
  if (p1Projects.length > 0) {
    views.push(...p1Projects)
  }

  // Add P2 Projects
  if (p2Projects.length > 0) {
    views.push(...p2Projects)
  }

  // Add upcoming at the end
  views.push({
    id: "upcoming",
    type: "upcoming",
    value: "upcoming",
    collapsible: true,
    expanded: true,
  })

  return views
}
