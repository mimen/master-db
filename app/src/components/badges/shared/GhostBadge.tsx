import type { LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"

/**
 * Ghost Badge - Generic reusable ghost badge for "add X" actions
 *
 * Pure view component for displaying "add" or placeholder badges.
 * Works with any icon and text - no entity-specific logic.
 * Always shows with dashed border and muted text styling.
 *
 * Use this for:
 * - "Add label", "Add schedule", "Add deadline", "Add project" actions
 * - Placeholder badges for missing properties
 * - Any "add" or "create" action shown on hover
 *
 * @example
 * ```tsx
 * function TaskRow({ task }) {
 *   return (
 *     <>
 *       {task.labels.length > 0 ? (
 *         // Show real labels
 *         task.labels.map(l => <LabelBadge key={l.id} label={l} />)
 *       ) : isHovered ? (
 *         // Show ghost "add label" on hover
 *         <GhostBadge
 *           icon={Tag}
 *           text="Add label"
 *           onClick={(e) => {
 *             e.stopPropagation()
 *             openLabelsDialog(task)
 *           }}
 *         />
 *       ) : null}
 *     </>
 *   )
 * }
 * ```
 */

export interface GhostBadgeProps {
  /**
   * Lucide icon component to display in badge
   * Receives className for sizing: "h-3 w-3"
   */
  icon: LucideIcon

  /**
   * Text to display next to icon (e.g., "Add label", "Set priority")
   */
  text: string

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void
}

export function GhostBadge({ icon: Icon, text, onClick }: GhostBadgeProps) {
  return (
    <div
      className="inline-flex items-center rounded-full border border-dashed px-2.5 py-0.5 text-xs font-normal gap-1.5 text-muted-foreground cursor-pointer hover:bg-accent/80 transition-colors"
      onClick={onClick}
    >
      <Icon className="h-3 w-3" />
      <span>{text}</span>
    </div>
  )
}
