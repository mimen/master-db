/**
 * Keyboard Shortcut Categories
 *
 * Helpers for organizing and grouping shortcuts by category
 */

import { getVisibleShortcuts } from './registry'
import type { ShortcutCategory, ShortcutDefinition, ShortcutSection } from './types'

/**
 * Category metadata for display
 */
export const CATEGORY_METADATA: Record<ShortcutCategory, { title: string; order: number }> = {
  navigation: { title: 'Navigation', order: 1 },
  general: { title: 'General', order: 2 },
  'task-actions': { title: 'Task Actions', order: 3 },
  'project-actions': { title: 'Project Actions', order: 4 },
  dialog: { title: 'General', order: 5 }, // Merged into General
}

/**
 * Group shortcuts by category
 */
export function groupShortcutsByCategory(shortcuts: ShortcutDefinition[]): ShortcutSection[] {
  const grouped = new Map<ShortcutCategory, ShortcutDefinition[]>()

  // Group shortcuts
  for (const shortcut of shortcuts) {
    const existing = grouped.get(shortcut.category) || []
    grouped.set(shortcut.category, [...existing, shortcut])
  }

  // Convert to sections with metadata
  const sections: ShortcutSection[] = []
  for (const [category, categoryShortcuts] of grouped.entries()) {
    const metadata = CATEGORY_METADATA[category]
    sections.push({
      title: metadata.title,
      category,
      shortcuts: categoryShortcuts,
    })
  }

  // Sort by order
  sections.sort((a, b) => {
    const orderA = CATEGORY_METADATA[a.category].order
    const orderB = CATEGORY_METADATA[b.category].order
    return orderA - orderB
  })

  return sections
}

/**
 * Get all shortcuts grouped by category
 */
export function getAllShortcutSections(): ShortcutSection[] {
  return groupShortcutsByCategory(getVisibleShortcuts())
}
