import type { LucideIcon } from "lucide-react"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Date Badge - Pure view component for displaying dates with status
 *
 * Entity-agnostic badge for due dates, deadlines, and any date-based properties.
 * Works for tasks, projects, or any entity with a date field.
 * Uses status-based coloring to indicate urgency (overdue, today, tomorrow, future).
 *
 * @example
 * ```tsx
 * function TaskRow({ task }) {
 *   const status = task.due_date
 *     ? isOverdue(task.due_date)
 *       ? 'overdue'
 *       : isToday(task.due_date)
 *       ? 'today'
 *       : isTomorrow(task.due_date)
 *       ? 'tomorrow'
 *       : 'future'
 *     : null
 *
 *   return (
 *     <>
 *       {task.due_date && (
 *         <DateBadge
 *           date={formatDate(task.due_date)}
 *           status={status}
 *           icon={Calendar}
 *           onClick={(e) => {
 *             e.stopPropagation()
 *             openDueDateDialog(task)
 *           }}
 *           onRemove={(e) => {
 *             e.stopPropagation()
 *             removeDueDate(task.id)
 *           }}
 *         />
 *       )}
 *     </>
 *   )
 * }
 * ```
 */

export interface DateBadgeProps {
  /**
   * Formatted date text (e.g., "Jan 15", "Today", "Tomorrow")
   * Parent is responsible for formatting the date string
   */
  date: string

  /**
   * Status of the date - determines coloring
   * - 'overdue': Red (urgent)
   * - 'today': Green (happening now)
   * - 'tomorrow': Purple (upcoming)
   * - 'future': Purple (later)
   */
  status: "overdue" | "today" | "tomorrow" | "future"

  /**
   * Lucide icon to display (Calendar, AlertCircle, etc.)
   */
  icon: LucideIcon

  /**
   * Click handler - called when badge body is clicked
   * Typically opens dialog to edit/view the date
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Remove handler - called when X button is clicked
   * If not provided, X button is not shown
   * Parent should stopPropagation if needed
   */
  onRemove?: (e: React.MouseEvent) => void

  /**
   * Optional: Show X button on hover (for removable dates)
   * @default true
   */
  showRemoveButton?: boolean
}

export function DateBadge({
  date,
  status,
  icon: Icon,
  onClick,
  onRemove,
  showRemoveButton = true,
}: DateBadgeProps) {
  // Status-based color classes
  const statusClasses = {
    overdue: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
    today: "text-green-600 border-green-600 dark:text-green-400 dark:border-green-400",
    tomorrow:
      "text-purple-600 border-purple-600 dark:text-purple-400 dark:border-purple-400",
    future:
      "text-purple-600 border-purple-600 dark:text-purple-400 dark:border-purple-400",
  }

  const [isHovering, setIsHovering] = React.useState(false)

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        statusClasses[status]
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <Icon className="h-3 w-3" />
      <span>{date}</span>
      {onRemove && showRemoveButton && isHovering && (
        <button
          className="ml-0.5 hover:text-destructive transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(e)
          }}
          aria-label="Remove date"
        >
          ✕
        </button>
      )}
    </Badge>
  )
}
