/**
 * Keyboard Shortcut Registry
 *
 * Central registry of all keyboard shortcuts in the application.
 * This is the single source of truth for keyboard shortcuts.
 */

import type { ShortcutDefinition } from './types'

/**
 * Complete registry of all keyboard shortcuts
 */
export const SHORTCUT_REGISTRY: ShortcutDefinition[] = [
  // ========================================
  // NAVIGATION (always available)
  // ========================================
  {
    id: 'nav-previous',
    description: 'Previous task or view',
    keys: ['↑'],
    category: 'navigation',
    context: 'always',
    visible: true,
  },
  {
    id: 'nav-previous-alt',
    description: 'Previous task or view',
    keys: ['←'],
    category: 'navigation',
    context: 'always',
    visible: false, // Hide duplicate, shown in nav-previous
  },
  {
    id: 'nav-next',
    description: 'Next task or view',
    keys: ['↓'],
    category: 'navigation',
    context: 'always',
    visible: true,
  },
  {
    id: 'nav-next-alt',
    description: 'Next task or view',
    keys: ['→'],
    category: 'navigation',
    context: 'always',
    visible: false, // Hide duplicate, shown in nav-next
  },

  // ========================================
  // GENERAL (always available)
  // ========================================
  {
    id: 'command-palette',
    description: 'Open command palette (search)',
    keys: ['⌘', 'K'],
    category: 'general',
    context: 'always',
    visible: true,
  },
  {
    id: 'toggle-sidebar',
    description: 'Toggle sidebar',
    keys: ['⌘', 'B'],
    category: 'general',
    context: 'always',
    visible: true,
  },
  {
    id: 'quick-add-task',
    description: 'Quick add task',
    keys: ['n'],
    category: 'general',
    context: 'always',
    visible: true,
  },
  {
    id: 'show-shortcuts',
    description: 'Show keyboard shortcuts',
    keys: ['?'],
    category: 'general',
    context: 'always',
    visible: true,
  },
  {
    id: 'sync-status',
    description: 'Show sync status',
    keys: ['⌘', 'Shift', 'S'],
    category: 'general',
    context: 'always',
    visible: true,
  },

  // ========================================
  // TASK ACTIONS (when task is focused)
  // ========================================
  {
    id: 'task-edit-content',
    description: 'Edit task content',
    keys: ['Enter'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-edit-description',
    description: 'Edit task description',
    keys: ['Shift', 'Enter'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-set-priority',
    description: 'Set priority',
    keys: ['p'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-move-project',
    description: 'Move to project',
    keys: ['#'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-add-labels',
    description: 'Add labels',
    keys: ['@'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-schedule',
    description: 'Schedule (due date)',
    keys: ['s'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-set-deadline',
    description: 'Set deadline',
    keys: ['Shift', 'D'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-complete',
    description: 'Complete task',
    keys: ['c'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-delete',
    description: 'Delete task',
    keys: ['Delete'],
    category: 'task-actions',
    context: 'task-focused',
    visible: true,
  },
  {
    id: 'task-delete-alt',
    description: 'Delete task',
    keys: ['Backspace'],
    category: 'task-actions',
    context: 'task-focused',
    visible: false, // Hide duplicate, shown in task-delete
  },

  // ========================================
  // PROJECT ACTIONS (when project is focused)
  // ========================================
  {
    id: 'project-edit-name',
    description: 'Edit project name',
    keys: ['Enter'],
    category: 'project-actions',
    context: 'project-focused',
    visible: true,
  },
  {
    id: 'project-edit-description',
    description: 'Edit project description',
    keys: ['Shift', 'Enter'],
    category: 'project-actions',
    context: 'project-focused',
    visible: true,
  },
  {
    id: 'project-set-priority',
    description: 'Set priority',
    keys: ['p'],
    category: 'project-actions',
    context: 'project-focused',
    visible: true,
  },
  {
    id: 'project-archive',
    description: 'Archive project',
    keys: ['e'],
    category: 'project-actions',
    context: 'project-focused',
    visible: true,
  },

  // Note: Dialog controls are context-dependent and shown inline in dialogs
]

/**
 * Get all shortcuts
 */
export function getAllShortcuts(): ShortcutDefinition[] {
  return SHORTCUT_REGISTRY
}

/**
 * Get visible shortcuts only
 */
export function getVisibleShortcuts(): ShortcutDefinition[] {
  return SHORTCUT_REGISTRY.filter((s) => s.visible !== false)
}

/**
 * Get shortcuts by category
 */
export function getShortcutsByCategory(category: ShortcutDefinition['category']): ShortcutDefinition[] {
  return SHORTCUT_REGISTRY.filter((s) => s.category === category)
}

/**
 * Get shortcuts by context
 */
export function getShortcutsByContext(context: ShortcutDefinition['context']): ShortcutDefinition[] {
  return SHORTCUT_REGISTRY.filter((s) => s.context === context)
}

/**
 * Get shortcut by ID
 */
export function getShortcutById(id: string): ShortcutDefinition | undefined {
  return SHORTCUT_REGISTRY.find((s) => s.id === id)
}
