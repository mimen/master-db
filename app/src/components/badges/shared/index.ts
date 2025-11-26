/**
 * Shared Badge Components
 *
 * Entity-agnostic badge components used across Tasks, Projects, and Routines.
 * All badges are pure view components - no embedded entity-specific logic.
 *
 * Components receive data as props (not entities) and handlers from parent.
 * Parent is responsible for:
 * - Computing colors (via utilities like getProjectColor, getLabelColor)
 * - Handling clicks and remove actions
 * - Managing ghost state display
 *
 * Core Badges (Used across all entity types):
 * - PriorityBadge: Priority with flag icon
 * - ProjectBadge: Project name with colored dot
 * - LabelBadge: Label/tag with optional color
 * - GhostBadge: Generic "add X" ghost badge
 *
 * Date/Time Badges (Routine-specific and generic):
 * - DateBadge: Generic date badge with status-based coloring (tasks, routines)
 * - TimeOfDayBadge: Routine preferred time of day
 * - IdealDayBadge: Routine preferred day of week
 * - DurationBadge: Routine estimated duration
 */

// Core badges
export { PriorityBadge, type PriorityBadgeProps } from "./PriorityBadge"
export { ProjectBadge, type ProjectBadgeProps } from "./ProjectBadge"
export { ProjectTypeBadge, type ProjectTypeBadgeProps } from "./ProjectTypeBadge"
export { LabelBadge, type LabelBadgeProps } from "./LabelBadge"
export { GhostBadge, type GhostBadgeProps } from "./GhostBadge"

// Date/Time badges
export { DateBadge, type DateBadgeProps } from "./DateBadge"
export { TimeOfDayBadge, type TimeOfDayBadgeProps } from "./TimeOfDayBadge"
export { IdealDayBadge, type IdealDayBadgeProps } from "./IdealDayBadge"
export { DurationBadge, type DurationBadgeProps } from "./DurationBadge"
