import { Sun } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Time of Day Badge - Pure view component for routine time preferences
 *
 * Routine-specific badge showing preferred time of day (Morning, Afternoon, Evening, Night).
 * Entity-agnostic in design - just takes timeOfDay string and handlers.
 *
 * @example
 * ```tsx
 * function RoutineRow({ routine }) {
 *   return (
 *     <TimeOfDayBadge
 *       timeOfDay={routine.timeOfDay}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openTimeDialog(routine)
 *       }}
 *       isGhost={!routine.timeOfDay}
 *     />
 *   )
 * }
 * ```
 */

export interface TimeOfDayBadgeProps {
  /**
   * Time of day string (e.g., "Morning", "Afternoon", "Evening", "Night")
   * Parent formats this based on stored value
   */
  timeOfDay: string

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Ghost state styling - shows dashed border + muted text
   * Use when time of day is not set
   */
  isGhost?: boolean
}

export function TimeOfDayBadge({
  timeOfDay,
  onClick,
  isGhost = false,
}: TimeOfDayBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        isGhost && "text-muted-foreground border-dashed"
      )}
      onClick={onClick}
    >
      <Sun className="h-3 w-3" />
      <span>{timeOfDay}</span>
    </Badge>
  )
}
