/**
 * Keyboard Shortcut Context Detection
 *
 * Helpers for determining which shortcuts are available based on app state
 */

import type { ShortcutContext, ShortcutDefinition } from './types'

/**
 * App context state for determining available shortcuts
 */
export interface AppContextState {
  /** Whether a task is currently focused/selected */
  hasTaskFocused: boolean

  /** Whether a project is currently focused/selected */
  hasProjectFocused: boolean

  /** Whether any dialog is currently open */
  hasDialogOpen: boolean
}

/**
 * Determine if a shortcut is available in the given context
 */
export function isShortcutAvailable(
  shortcut: ShortcutDefinition,
  contextState: AppContextState
): boolean {
  switch (shortcut.context) {
    case 'always':
      return true

    case 'task-focused':
      return contextState.hasTaskFocused

    case 'project-focused':
      return contextState.hasProjectFocused

    case 'dialog-open':
      return contextState.hasDialogOpen

    default:
      return false
  }
}

/**
 * Filter shortcuts based on app context
 */
export function filterShortcutsByContext(
  shortcuts: ShortcutDefinition[],
  contextState: AppContextState
): ShortcutDefinition[] {
  return shortcuts.filter((shortcut) => isShortcutAvailable(shortcut, contextState))
}

/**
 * Get active contexts based on state
 */
export function getActiveContexts(contextState: AppContextState): ShortcutContext[] {
  const contexts: ShortcutContext[] = ['always']

  if (contextState.hasTaskFocused) {
    contexts.push('task-focused')
  }

  if (contextState.hasProjectFocused) {
    contexts.push('project-focused')
  }

  if (contextState.hasDialogOpen) {
    contexts.push('dialog-open')
  }

  return contexts
}
