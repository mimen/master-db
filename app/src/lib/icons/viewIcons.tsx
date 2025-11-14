import { AlertCircle, Calendar, CalendarRange, Filter, Flag, Inbox, Settings, Sunrise, Tag } from "lucide-react"

import { getProjectColor } from "../colors"
import { getPriorityColorClass } from "../priorities"

import type { ViewKey } from "@/lib/views/types"
import { cn } from "@/lib/utils"

export type IconSize = "sm" | "md" | "lg"

const ICON_SIZES = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const

interface IconOptions {
  size?: IconSize
  className?: string
  color?: string
}

/**
 * Get the icon for any view based on its ViewKey.
 * This is the single source of truth for all view icons across the app.
 *
 * Icons automatically include semantic colors where appropriate (time filters, priorities, labels).
 */
export function getViewIcon(viewKey: ViewKey, options: IconOptions = {}): React.ReactNode {
  const { size = "md", className = "", color } = options
  const sizeClass = ICON_SIZES[size]
  const finalClassName = cn(sizeClass, className)

  // Top-level views
  if (viewKey === "view:inbox") {
    return <Inbox className={finalClassName} />
  }

  if (viewKey === "view:today") {
    return <Calendar className={cn(finalClassName, "text-blue-500")} />
  }

  if (viewKey === "view:upcoming") {
    return <Calendar className={cn(finalClassName, "text-green-500")} />
  }

  if (viewKey === "view:priority-queue") {
    return <Filter className={finalClassName} />
  }

  if (viewKey === "view:settings") {
    return <Settings className={finalClassName} />
  }

  // Time-based views (always colored)
  if (viewKey === "view:time:overdue") {
    return <AlertCircle className={cn(finalClassName, "text-red-500")} />
  }

  if (viewKey === "view:time:today") {
    return <Calendar className={cn(finalClassName, "text-blue-500")} />
  }

  if (viewKey === "view:time:upcoming") {
    return <Calendar className={cn(finalClassName, "text-green-500")} />
  }

  if (viewKey === "view:time:no-date") {
    return <Calendar className={cn(finalClassName, "text-gray-500")} />
  }

  // Priority views (P1-P4) - always colored
  if (viewKey.startsWith("view:priority:")) {
    const priorityId = viewKey.replace("view:priority:", "") as "p1" | "p2" | "p3" | "p4"
    const level = priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1
    const colorClass = getPriorityColorClass(level)

    return (
      <Flag
        className={cn(finalClassName, colorClass)}
        fill="currentColor"
      />
    )
  }

  // Priority Projects views - always colored
  if (viewKey.startsWith("view:priority-projects:")) {
    const priorityId = viewKey.replace("view:priority-projects:", "") as "p1" | "p2" | "p3" | "p4"
    const level = priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1
    const colorClass = getPriorityColorClass(level)

    return (
      <Flag
        className={cn(finalClassName, colorClass)}
        fill="currentColor"
      />
    )
  }

  // Label views - support custom colors
  if (viewKey.startsWith("view:label:")) {
    if (color) {
      return (
        <Tag
          className={finalClassName}
          style={{ color: getProjectColor(color) }}
        />
      )
    }
    return <Tag className={finalClassName} />
  }

  // Multi-list views
  if (viewKey === "view:multi:priority-queue") {
    return <Filter className={finalClassName} />
  }

  if (viewKey === "view:multi:morning-review") {
    return <Sunrise className={finalClassName} />
  }

  if (viewKey === "view:multi:weekly-planning") {
    return <CalendarRange className={finalClassName} />
  }

  // Default fallback
  return null
}

/**
 * Get a project icon (colored dot) for a given project
 */
export function getProjectIcon(color: string, options: IconOptions = {}): React.ReactNode {
  const { size = "md", className = "" } = options

  const dotSizes = {
    sm: "w-2.5 h-2.5",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  }

  const dotSize = dotSizes[size]

  return (
    <div
      className={cn(dotSize, "rounded-full flex-shrink-0", className)}
      style={{ backgroundColor: getProjectColor(color) }}
    />
  )
}

/**
 * Get a label icon (tag with color)
 */
export function getLabelIcon(color: string, options: IconOptions = {}): React.ReactNode {
  const { size = "md", className = "" } = options
  const sizeClass = ICON_SIZES[size]

  return (
    <Tag
      className={cn(sizeClass, className)}
      style={{ color: getProjectColor(color) }}
    />
  )
}
