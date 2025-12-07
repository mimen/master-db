import { SIDEBAR_CONFIG } from "./sidebarConfig"

import type { ViewKey } from "@/lib/views/types"

/**
 * Extracted view groups for command palette
 */
export interface ExtractedViewGroup {
  category: "primary" | "time" | "folder-categories" | "routine-tasks"
  label?: string
  viewKeys: ViewKey[]
}

/**
 * Extract all navigable view keys from SIDEBAR_CONFIG
 * This ensures the command palette stays in sync with the sidebar configuration
 *
 * Note: Priorities and priority-projects are handled separately by PRIORITY_FILTER_ITEMS
 * and PRIORITY_PROJECTS_ITEMS to maintain their custom colored icons
 */
export function extractNavigableViews(): ExtractedViewGroup[] {
  const groups: ExtractedViewGroup[] = []

  for (const section of SIDEBAR_CONFIG.sections) {
    // Skip sections that are handled separately:
    // - folders/labels: dynamically generated project/label lists
    // - priorities: handled by PRIORITY_FILTER_ITEMS with custom colored icons
    if (section.section === "folders" || section.section === "labels" || section.section === "priorities") {
      continue
    }

    // Handle routines section specially - it has sortOptions but we still want the parent view
    if (section.section === "routines") {
      groups.push({
        category: "primary",
        viewKeys: ["view:routines"],
      })
      continue
    }

    // Add section items as a group
    if (section.items && section.items.length > 0) {
      const category = section.section === "primary"
        ? "primary"
        : section.section === "time"
        ? "time"
        : section.section === "routineTasks"
        ? "routine-tasks"
        : "primary"

      groups.push({
        category,
        label: section.label,
        viewKeys: section.items as ViewKey[],
      })
    }
  }

  // Extract folder categories from subviews
  const foldersSubview = SIDEBAR_CONFIG.subviews["view:folders"]
  if (foldersSubview && "items" in foldersSubview) {
    groups.push({
      category: "folder-categories",
      label: "Folder Categories",
      viewKeys: foldersSubview.items as ViewKey[],
    })
  }

  return groups
}

/**
 * Get all navigable view keys as a flat array
 */
export function getAllNavigableViewKeys(): ViewKey[] {
  return extractNavigableViews().flatMap((group) => group.viewKeys)
}
