/**
 * Multi-list system types
 *
 * Multi-lists are composable sequences of views that can be expanded into
 * multiple task lists. They reuse existing view identifiers for consistency.
 */

/**
 * A single item in a multi-list sequence
 * Uses existing view identifier format (e.g., "inbox", "priority:p1", "project:123")
 */
export type MultiListItem = {
  /** View identifier (reuses existing format) */
  view: string

  /** Optional display name override */
  name?: string

  /** Optional icon override */
  icon?: string

  /** Optional limit on tasks shown from this view */
  maxTasks?: number
}

/**
 * Multi-list configuration
 */
export type MultiListConfig = {
  /** Unique identifier (used as "multi:id") */
  id: string

  /** Display name */
  name: string

  /** Optional icon */
  icon?: string

  /** Ordered sequence of view items */
  sequence: MultiListItem[]

  /** Optional description */
  description?: string

  /** Optional time estimate in minutes */
  estimatedMinutes?: number

  /** Whether this is a built-in multi-list */
  isBuiltIn?: boolean

  /** User ID (for user-defined multi-lists) */
  userId?: string

  /** Timestamps */
  createdAt?: string
  updatedAt?: string
}

/**
 * View types extended to support multi-lists
 */
export type ExtendedViewType =
  | "inbox"
  | "today"
  | "upcoming"
  | "project"
  | "time"
  | "priority"
  | "label"
  | "multi"              // NEW: multi-list
  | "priority-projects"  // NEW: priority-projects expansion
