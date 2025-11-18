import { Calendar } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Ideal Day Badge - Pure view component for routine day preferences
 *
 * Routine-specific badge showing preferred day of week for routine completion.
 * Takes a 0-6 numeric day value and displays human-readable day name.
 * Entity-agnostic in design - just takes day number and handlers.
 *
 * @example
 * ```tsx
 * function RoutineRow({ routine }) {
 *   return (
 *     <IdealDayBadge
 *       day={routine.idealDay}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openDayDialog(routine)
 *       }}
 *       isGhost={!routine.idealDay}
 *     />
 *   )
 * }
 * ```
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export interface IdealDayBadgeProps {
  /**
   * Day of week as number 0-6 (0 = Sunday, 6 = Saturday)
   */
  day: number

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Ghost state styling - shows dashed border + muted text
   * Use when ideal day is not set
   */
  isGhost?: boolean
}

export function IdealDayBadge({
  day,
  onClick,
  isGhost = false,
}: IdealDayBadgeProps) {
  const dayName = DAY_NAMES[day % 7] || "?"

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        isGhost && "text-muted-foreground border-dashed"
      )}
      onClick={onClick}
    >
      <Calendar className="h-3 w-3" />
      <span>{dayName}</span>
    </Badge>
  )
}
