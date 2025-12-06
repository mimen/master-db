import type { ViewBuildContext, ViewKey } from "@/lib/views/types"
import { extractLabelNameFromSlug, extractProjectIdFromSlug, getLabelSlug, getProjectSlug } from "./slugs"

/**
 * Convert a ViewKey to a URL path
 * Examples:
 *   "view:inbox" → "/inbox"
 *   "view:multi:priority-queue" → "/priority-queue"
 *   "view:projects" → "/projects"
 *   "view:project:abc123" → "/projects/my-project"
 *   "view:priority:p1" → "/priorities/p1"
 */
export function viewKeyToPath(viewKey: ViewKey, context?: ViewBuildContext): string {
  // Root/Inbox
  if (viewKey === "view:inbox") {
    return "/inbox"
  }

  // Static views
  if (viewKey === "view:today") return "/today"
  if (viewKey === "view:upcoming") return "/upcoming"
  if (viewKey === "view:projects") return "/projects"
  if (viewKey === "view:folders") return "/folders"
  if (viewKey === "view:folders:projects") return "/folders/projects"
  if (viewKey === "view:folders:areas") return "/folders/areas"
  if (viewKey === "view:folders:unassigned") return "/folders/unassigned"
  if (viewKey === "view:routines") return "/routines"
  if (viewKey === "view:settings") return "/settings"

  // Routine task views
  if (viewKey.startsWith("view:routine-tasks:")) {
    const filter = viewKey.replace("view:routine-tasks:", "")
    return `/routine-tasks/${filter}`
  }

  // Routine project views
  if (viewKey.startsWith("view:routines:project:")) {
    const projectId = viewKey.replace("view:routines:project:", "")
    const slug = getProjectSlug(projectId, context?.projects)
    return `/routines/projects/${slug}`
  }

  // Multi-list views
  if (viewKey === "view:multi:priority-queue") return "/priority-queue"
  if (viewKey.startsWith("view:multi:")) {
    const multiId = viewKey.replace("view:multi:", "")
    return `/multi/${multiId}`
  }

  // Time ranges
  if (viewKey.startsWith("view:time:")) {
    const range = viewKey.replace("view:time:", "")
    return `/time/${range}`
  }

  // Priority views (tasks)
  if (viewKey.startsWith("view:priority:")) {
    const priorityId = viewKey.replace("view:priority:", "")
    return `/priorities/${priorityId}`
  }

  // Priority-projects views
  if (viewKey.startsWith("view:priority-projects:")) {
    const priorityId = viewKey.replace("view:priority-projects:", "")
    return `/priorities/${priorityId}/projects`
  }

  // Project views (with slug support)
  if (viewKey.startsWith("view:project-family:")) {
    const projectId = viewKey.replace("view:project-family:", "")
    const slug = getProjectSlug(projectId, context?.projects)
    return `/projects/${slug}/family`
  }
  if (viewKey.startsWith("view:project:")) {
    const projectId = viewKey.replace("view:project:", "")
    const slug = getProjectSlug(projectId, context?.projects)
    return `/projects/${slug}`
  }

  // Label views (with slug support)
  if (viewKey.startsWith("view:label:")) {
    const labelName = viewKey.replace("view:label:", "")
    const slug = getLabelSlug(labelName, context?.labels)
    return `/labels/${slug}`
  }

  // Fallback to inbox
  return "/inbox"
}

/**
 * Parse a URL path to a ViewKey
 * Returns null if the path doesn't match any known pattern
 * Examples:
 *   "/inbox" → "view:inbox"
 *   "/" → "view:inbox"
 *   "/projects/my-project" → "view:project:abc123def..." (looks up by name)
 *   "/priorities/p1" → "view:priority:p1"
 */
export function pathToViewKey(path: string, context?: ViewBuildContext): ViewKey | null {
  // Normalize: remove trailing slash, ensure leading slash
  const normalized = path === "/" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`

  // Root or inbox
  if (normalized === "/" || normalized === "/inbox") {
    return "view:inbox"
  }

  // Static views
  if (normalized === "/today") return "view:today"
  if (normalized === "/upcoming") return "view:upcoming"
  if (normalized === "/projects") return "view:projects"
  if (normalized === "/folders") return "view:folders"
  if (normalized === "/folders/projects") return "view:folders:projects"
  if (normalized === "/folders/areas") return "view:folders:areas"
  if (normalized === "/folders/unassigned") return "view:folders:unassigned"
  if (normalized === "/routines") return "view:routines"
  if (normalized === "/settings") return "view:settings"

  // Routine task views
  const routineTaskMatch = normalized.match(/^\/routine-tasks\/([^/]+)$/)
  if (routineTaskMatch) {
    return `view:routine-tasks:${routineTaskMatch[1]}` as ViewKey
  }

  // Routine project views (with slug support)
  const routineProjectMatch = normalized.match(/^\/routines\/projects\/([^/]+)$/)
  if (routineProjectMatch) {
    const slugOrId = routineProjectMatch[1]
    // Try to extract project ID from slug, fallback to using as-is
    const projectId = extractProjectIdFromSlug(slugOrId, context?.projects) ?? slugOrId
    return `view:routines:project:${projectId}` as ViewKey
  }

  // Priority queue (special multi-list)
  if (normalized === "/priority-queue") {
    return "view:multi:priority-queue"
  }

  // Multi-list views
  if (normalized.startsWith("/multi/")) {
    const multiId = normalized.replace("/multi/", "")
    return `view:multi:${multiId}` as ViewKey
  }

  // Time ranges
  if (normalized.startsWith("/time/")) {
    const range = normalized.replace("/time/", "")
    return `view:time:${range}` as ViewKey
  }

  // Priority views
  const priorityMatch = normalized.match(/^\/priorities\/(p[1-4])$/)
  if (priorityMatch) {
    return `view:priority:${priorityMatch[1]}` as ViewKey
  }

  // Priority-projects views
  const priorityProjectsMatch = normalized.match(/^\/priorities\/(p[1-4])\/projects$/)
  if (priorityProjectsMatch) {
    return `view:priority-projects:${priorityProjectsMatch[1]}` as ViewKey
  }

  // Project family view (with slug support)
  const projectFamilyMatch = normalized.match(/^\/projects\/([^/]+)\/family$/)
  if (projectFamilyMatch) {
    const slugOrId = projectFamilyMatch[1]
    // Try to extract project ID from slug, fallback to using as-is
    const projectId = extractProjectIdFromSlug(slugOrId, context?.projects) ?? slugOrId
    return `view:project-family:${projectId}` as ViewKey
  }

  // Single project view (with slug support)
  const projectMatch = normalized.match(/^\/projects\/([^/]+)$/)
  if (projectMatch) {
    const slugOrId = projectMatch[1]
    // Try to extract project ID from slug, fallback to using as-is
    const projectId = extractProjectIdFromSlug(slugOrId, context?.projects) ?? slugOrId
    return `view:project:${projectId}` as ViewKey
  }

  // Label views (with slug support)
  const labelMatch = normalized.match(/^\/labels\/(.+)$/)
  if (labelMatch) {
    const slugOrName = labelMatch[1]
    // Try to extract label name from slug, fallback to using as-is
    const labelName = extractLabelNameFromSlug(slugOrName, context?.labels) ?? slugOrName
    return `view:label:${labelName}` as ViewKey
  }

  // Unknown path
  return null
}
