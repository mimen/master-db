import type { TodoistLabelDoc, TodoistProjects } from "@/types/convex/todoist"

/**
 * Convert a string to a URL-friendly slug
 * Examples:
 *   "My Project" → "my-project"
 *   "Work/Life Balance" → "work-life-balance"
 *   "2024 Goals" → "2024-goals"
 */
export function createSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special characters except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
}

/**
 * Create a project slug from the project name
 * Format: "{slug}"
 * Examples:
 *   "My Project" → "my-project"
 *   "Work Tasks" → "work-tasks"
 */
export function createProjectSlug(projectName: string): string {
  return createSlug(projectName)
}

/**
 * Extract project ID from a slug by matching the project name
 * Examples:
 *   "my-project" → find project with name "My Project"
 *   "work-tasks" → find project with name "Work Tasks"
 */
export function extractProjectIdFromSlug(
  slug: string,
  projects?: TodoistProjects
): string | null {
  if (!projects) return null

  // Find project where the slugified name matches the slug
  const project = projects.find((p) => createSlug(p.name) === slug)
  return project?.todoist_id ?? null
}

/**
 * Get the slug for a project (for display/URLs)
 */
export function getProjectSlug(
  projectId: string,
  projects?: TodoistProjects
): string {
  if (!projects) return projectId

  const project = projects.find((p) => p.todoist_id === projectId)
  if (!project) return projectId

  return createProjectSlug(project.name)
}

/**
 * Create a label slug from the label name
 * Format: "{slug}"
 * Examples:
 *   "Work Tasks" → "work-tasks"
 *   "High Priority" → "high-priority"
 */
export function createLabelSlug(labelName: string): string {
  return createSlug(labelName)
}

/**
 * Extract label name from a slug by matching the label
 * Examples:
 *   "work-tasks" → find label with name "Work Tasks"
 *   "high-priority" → find label with name "High Priority"
 */
export function extractLabelNameFromSlug(
  slug: string,
  labels?: TodoistLabelDoc[]
): string | null {
  if (!labels) return null

  // Find label where the slugified name matches the slug
  const label = labels.find((l) => createSlug(l.name) === slug)
  return label?.name ?? null
}

/**
 * Get the slug for a label (for display/URLs)
 */
export function getLabelSlug(
  labelName: string,
  labels?: TodoistLabelDoc[]
): string {
  if (!labels) return labelName

  const label = labels.find((l) => l.name === labelName)
  if (!label) return labelName

  return createLabelSlug(label.name)
}
