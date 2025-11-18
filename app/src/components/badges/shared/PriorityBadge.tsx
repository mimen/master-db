import { Flag } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Priority Badge - Pure view component for displaying task/project/routine priority
 *
 * Entity-agnostic badge that displays priority information with visual flag.
 * Receives all data as props - no entity-specific logic.
 *
 * @example
 * ```tsx
 * function TaskRow({ task }) {
 *   const priority = usePriority(task.priority)
 *
 *   return (
 *     <PriorityBadge
 *       priority={priority}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openPriorityDialog(task)
 *       }}
 *       isGhost={!priority.showFlag}
 *     />
 *   )
 * }
 * ```
 */

export interface PriorityBadgeProps {
  /**
   * Priority data: label (e.g., "P1", "P2") and colorClass (Tailwind color)
   */
  priority: {
    label: string
    colorClass: string | null
  }

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Ghost state styling - shows dashed border + muted text
   * Use when priority doesn't exist (P4) or should be "add" state
   */
  isGhost?: boolean
}

export function PriorityBadge({
  priority,
  onClick,
  isGhost = false,
}: PriorityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        priority.colorClass,
        isGhost && "text-muted-foreground border-dashed"
      )}
      onClick={onClick}
    >
      <Flag className="h-3 w-3" fill="currentColor" />
      <span>{priority.label}</span>
    </Badge>
  )
}
