/**
 * Keyboard Shortcut Registry Types
 *
 * Defines the structure for centralized keyboard shortcut management
 * across the application.
 */

/**
 * Shortcut category for organizational purposes
 */
export type ShortcutCategory =
  | 'navigation'     // App-wide navigation
  | 'task-actions'   // Task-specific actions
  | 'project-actions' // Project-specific actions
  | 'dialog'         // Dialog interactions
  | 'general'        // General app actions

/**
 * Context in which a shortcut is available
 */
export type ShortcutContext =
  | 'always'           // Always available
  | 'task-focused'     // Only when a task is focused/selected
  | 'project-focused'  // Only when a project is focused/selected
  | 'dialog-open'      // Only when a dialog is open

/**
 * Individual key combination
 * e.g., ['Shift', 'D'] or ['Enter'] or ['↑']
 */
export type KeyCombination = string[]

/**
 * Complete shortcut definition
 */
export interface ShortcutDefinition {
  /** Unique identifier for this shortcut */
  id: string

  /** Display name/description of what this shortcut does */
  description: string

  /** Key combination(s) that trigger this shortcut */
  keys: KeyCombination

  /** Category for organization */
  category: ShortcutCategory

  /** Context in which this shortcut is available */
  context: ShortcutContext

  /** Whether this shortcut should be shown in the help dialog */
  visible?: boolean
}

/**
 * Grouped shortcuts by category for display purposes
 */
export interface ShortcutSection {
  title: string
  category: ShortcutCategory
  shortcuts: ShortcutDefinition[]
}
