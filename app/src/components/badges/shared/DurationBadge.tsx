import { Clock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Duration Badge - Pure view component for routine duration/estimated time
 *
 * Routine-specific badge showing estimated time to complete routine.
 * Displays formatted duration string (e.g., "30m", "1h", "1h 30m").
 * Entity-agnostic in design - just takes duration string and handler.
 *
 * @example
 * ```tsx
 * function RoutineRow({ routine }) {
 *   return (
 *     <DurationBadge
 *       duration={routine.estimatedDuration}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openDurationDialog(routine)
 *       }}
 *       colorClass="text-blue-600 dark:text-blue-400"
 *     />
 *   )
 * }
 * ```
 */

export interface DurationBadgeProps {
  /**
   * Duration string - parent formats this (e.g., "30m", "1h", "1h 30m")
   */
  duration: string

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Optional: Color class for styling
   * Use Tailwind color classes like "text-blue-600 dark:text-blue-400"
   */
  colorClass?: string
}

export function DurationBadge({
  duration,
  onClick,
  colorClass,
}: DurationBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        colorClass
      )}
      onClick={onClick}
    >
      <Clock className="h-3 w-3" />
      <span>{duration}</span>
    </Badge>
  )
}
