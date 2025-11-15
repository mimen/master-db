/**
 * Keyboard Shortcuts Registry
 *
 * Centralized keyboard shortcut management system.
 * Export all public APIs.
 */

// Types
export type {
  ShortcutCategory,
  ShortcutContext,
  KeyCombination,
  ShortcutDefinition,
  ShortcutSection,
} from './types'

// Registry
export {
  SHORTCUT_REGISTRY,
  getAllShortcuts,
  getVisibleShortcuts,
  getShortcutsByCategory,
  getShortcutsByContext,
  getShortcutById,
} from './registry'

// Categories
export {
  CATEGORY_METADATA,
  groupShortcutsByCategory,
  getAllShortcutSections,
} from './categories'

// Context
export type { AppContextState } from './context'
export {
  isShortcutAvailable,
  filterShortcutsByContext,
  getActiveContexts,
} from './context'
