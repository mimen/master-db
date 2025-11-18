import type { ViewBuildContext, ViewKey } from "./types"
import { resolveView } from "./viewDefinitions"

/**
 * CountRegistry provides a single source of truth for all task counts.
 *
 * Core principle: List counts are the fundamental unit.
 * - Views are containers of lists with icon and metadata
 * - View counts are computed by summing all list counts in that view
 *
 * Usage:
 * ```typescript
 * const registry = new CountRegistry(listCounts)
 *
 * // Get count for any view (single-list or multi-list)
 * const inboxCount = registry.getCountForView("view:inbox")
 * const priorityQueueCount = registry.getCountForView("view:multi:priority-queue")
 * ```
 */
export class CountRegistry {
  private listCounts: Record<string, number>

  constructor(listCounts: Record<string, number>) {
    this.listCounts = listCounts
  }

  /**
   * Get the task count for any view by summing its list counts.
   *
   * Works for:
   * - Single-list views (Inbox, Today, etc.)
   * - Multi-list views (Priority Queue, etc.)
   * - Project family views (parent + children)
   *
   * @param viewKey - The view to get count for
   * @param context - Optional context with projects/labels data for view resolution
   * @returns Total count of tasks in the view
   */
  getCountForView(viewKey: ViewKey, context?: ViewBuildContext): number {
    try {
      // Resolve view to get its lists
      const view = resolveView(viewKey, context)

      // Sum all list counts
      return view.lists.reduce((sum, list) => {
        // Map list instance ID to count key
        const countKey = this.getCountKeyFromListId(list.id, list.query)
        const count = this.listCounts[countKey] ?? 0
        return sum + count
      }, 0)
    } catch (error) {
      // If view resolution fails, return 0
      console.warn(`Failed to resolve view ${viewKey}:`, error)
      return 0
    }
  }

  /**
   * Get count for a specific list by its ID or query.
   *
   * @param listId - The list instance ID (e.g., "view:inbox:main")
   * @param query - The list query definition
   * @returns Count for the specific list
   */
  getCountForList(listId: string, query?: { type: string; [key: string]: unknown }): number {
    const countKey = this.getCountKeyFromListId(listId, query)
    return this.listCounts[countKey] ?? 0
  }

  /**
   * Convert a list instance ID to a count key.
   *
   * Maps list IDs like:
   * - "view:inbox:main" -> "list:inbox"
   * - "view:today:today" -> "list:time:today"
   * - "view:project:123:project-123" -> "list:project:123"
   * - "view:priority:p1:p1" -> "list:priority:p1"
   * - "view:label:work:work" -> "list:label:work"
   * - "view:projects:main" -> "list:projects"
   *
   * @private
   */
  private getCountKeyFromListId(
    listId: string,
    query?: { type: string; [key: string]: unknown }
  ): string {
    // If we have query info, use it (most reliable)
    if (query) {
      switch (query.type) {
        case "inbox":
          return "list:inbox"
        case "time": {
          // Normalize "no-date" to "nodate" to match count storage
          const range = query.range === "no-date" ? "nodate" : query.range
          return `list:time:${range}`
        }
        case "project":
          return `list:project:${query.projectId}`
        case "projects":
          if (query.projectType === "project-type") {
            return "list:projects-only"
          } else if (query.projectType === "area-of-responsibility") {
            return "list:areas-only"
          } else if (query.projectType === "unassigned") {
            return "list:unassigned-folders"
          }
          return "list:projects"
        case "routines":
          return query.projectId ? `list:routines:${query.projectId}` : "list:routines"
        case "priority": {
          // Map API priority to UI level: API 4=P1, 3=P2, 2=P3, 1=P4
          const apiToUi = { 4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4' }
          const uiLevel = apiToUi[query.priority as 1 | 2 | 3 | 4] || `p${query.priority}`
          return `list:priority:${uiLevel}`
        }
        case "label":
          return `list:label:${query.label}`
      }
    }

    // Fallback: parse from list ID
    // List IDs follow pattern: "view:{type}:{params}:{suffix}"

    // Inbox special case
    if (listId.includes("inbox")) {
      return "list:inbox"
    }

    // Projects special cases
    if (listId.includes("view:folders:projects")) {
      return "list:projects-only"
    }
    if (listId.includes("view:folders:areas")) {
      return "list:areas-only"
    }
    if (listId.includes("view:folders:unassigned")) {
      return "list:unassigned-folders"
    }
    if (listId.includes("view:projects") || listId.includes("view:folders")) {
      return "list:projects"
    }

    // Routines: "view:project:123:routines-456" (project-specific)
    const projectRoutineMatch = listId.match(/view:project:([^:]+):.*routines/)
    if (projectRoutineMatch) {
      return `list:routines:${projectRoutineMatch[1]}`
    }

    // Routines special case (global)
    if (listId.includes("view:routines")) {
      return "list:routines"
    }

    // Time filters: "view:time:today:today" or "view:today:today"
    const timeMatch = listId.match(/view:(time:)?(overdue|today|upcoming|tomorrow|next7days|future|no-date|nodate)/)
    if (timeMatch) {
      const range = timeMatch[2]
      // Normalize "no-date" to "nodate"
      return `list:time:${range === "no-date" ? "nodate" : range}`
    }

    // Project: "view:project:123:project-123"
    const projectMatch = listId.match(/view:project:([^:]+):/)
    if (projectMatch) {
      return `list:project:${projectMatch[1]}`
    }

    // Priority: "view:priority:p1:p1"
    const priorityMatch = listId.match(/view:priority:(p[1-4]):/)
    if (priorityMatch) {
      return `list:priority:${priorityMatch[1]}`
    }

    // Label: "view:label:work:work"
    const labelMatch = listId.match(/view:label:([^:]+):/)
    if (labelMatch) {
      return `list:label:${labelMatch[1]}`
    }

    // If we can't parse it, log warning and return 0
    console.warn(`Could not parse list ID to count key: ${listId}`)
    return ""
  }

  /**
   * Get all list counts (raw data).
   * Useful for debugging.
   */
  getAllCounts(): Record<string, number> {
    return { ...this.listCounts }
  }

  /**
   * Check if counts are loaded.
   */
  isLoaded(): boolean {
    return Object.keys(this.listCounts).length > 0
  }
}
