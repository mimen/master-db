import { AlertCircle, Calendar, CalendarCheck, CalendarRange, ClipboardList, FastForward, Filter, Flag, Folder, Inbox, Moon, Repeat, Settings, Sunrise, Tag, Zap } from "lucide-react"
import type { ReactNode } from "react"

import { getProjectColor } from "../colors"
import { getPriorityColorClass } from "../priorities"

import { cn } from "@/lib/utils"
import type { ViewKey } from "@/lib/views/types"

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
export function getViewIcon(viewKey: ViewKey, options: IconOptions = {}): ReactNode {
  const { size = "md", className = "", color } = options
  const sizeClass = ICON_SIZES[size]
  const finalClassName = cn(sizeClass, className)

  // Top-level views
  if (viewKey === "view:inbox") {
    return <Inbox className={finalClassName} />
  }

  if (viewKey === "view:today") {
    return <Calendar className={cn(finalClassName, "text-blue-600 dark:text-blue-400")} />
  }

  if (viewKey === "view:upcoming") {
    return <Calendar className={cn(finalClassName, "text-green-600 dark:text-green-400")} />
  }

  if (viewKey === "view:priority-queue") {
    return <Filter className={finalClassName} />
  }

  if (viewKey === "view:projects") {
    return <Folder className={finalClassName} />
  }

  if (viewKey === "view:folders") {
    return <Folder className={finalClassName} />
  }

  if (viewKey === "view:folders:projects") {
    // Outline gray circle (matches project-type items which have outline)
    // Always use "md" size to match individual project icons
    return (
      <div
        className={cn("w-3 h-3 border-[1.5px] rounded-full flex-shrink-0 border-gray-500 dark:border-gray-400", className)}
      />
    )
  }

  if (viewKey === "view:folders:areas") {
    // Filled gray circle (matches area-of-responsibility items which are solid)
    // Always use "md" size to match individual area icons
    return (
      <div
        className={cn("w-3 h-3 rounded-full flex-shrink-0 bg-gray-500 dark:bg-gray-400", className)}
      />
    )
  }

  if (viewKey === "view:folders:unassigned") {
    // Render underscore character
    // Use fixed w-3 h-3 size to match circles above
    return (
      <span className={cn("w-3 h-3 flex items-center justify-center text-gray-500 dark:text-gray-400 font-medium text-xs leading-none", className)}>
        _
      </span>
    )
  }

  if (viewKey === "view:routines") {
    return <Repeat className={finalClassName} />
  }

  if (viewKey === "view:settings") {
    return <Settings className={finalClassName} />
  }

  // Time-based views (always colored)
  if (viewKey === "view:time:overdue") {
    return <AlertCircle className={cn(finalClassName, "text-red-600 dark:text-red-400")} />
  }

  if (viewKey === "view:time:today") {
    return <Calendar className={cn(finalClassName, "text-green-600 dark:text-green-400")} />
  }

  if (viewKey === "view:time:upcoming") {
    return <Calendar className={cn(finalClassName, "text-purple-600 dark:text-purple-400")} />
  }

  if (viewKey === "view:time:no-date") {
    return <Calendar className={cn(finalClassName, "text-gray-600 dark:text-gray-400")} />
  }

  // Routine task views
  if (viewKey === "view:routine-tasks:overdue") {
    return <AlertCircle className={cn(finalClassName, "text-red-600 dark:text-red-400")} />
  }

  if (viewKey === "view:routine-tasks:morning") {
    return <Sunrise className={cn(finalClassName, "text-amber-600 dark:text-amber-400")} />
  }

  if (viewKey === "view:routine-tasks:night") {
    return <Moon className={cn(finalClassName, "text-indigo-600 dark:text-indigo-400")} />
  }

  if (viewKey === "view:routine-tasks:todays") {
    return <CalendarCheck className={cn(finalClassName, "text-green-600 dark:text-green-400")} />
  }

  if (viewKey === "view:routine-tasks:get-ahead") {
    return <FastForward className={cn(finalClassName, "text-blue-600 dark:text-blue-400")} />
  }

  // Routine project views - colored to project color
  if (viewKey.startsWith("view:routines:project:")) {
    if (color) {
      return (
        <Repeat
          className={finalClassName}
          style={{ color: getProjectColor(color) }}
        />
      )
    }
    return <Repeat className={finalClassName} />
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

  if (viewKey === "view:multi:daily-planning") {
    return <ClipboardList className={finalClassName} />
  }

  if (viewKey === "view:multi:daily-execution") {
    return <Zap className={finalClassName} />
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
 *
 * @param color - Project color code
 * @param options - Icon options including size, className, and optional isProjectType flag
 * @param options.isProjectType - If true, renders hollow circle (project-type), otherwise solid (area-of-responsibility)
 */
export function getProjectIcon(
  color: string,
  options: IconOptions & { isProjectType?: boolean } = {}
): ReactNode {
  const { size = "md", className = "", isProjectType = false } = options

  const dotSizes = {
    sm: "w-2.5 h-2.5",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  }

  const borderSizes = {
    sm: "border",
    md: "border-[1.5px]",
    lg: "border-2",
  }

  const dotSize = dotSizes[size]
  const borderSize = borderSizes[size]

  if (isProjectType) {
    // Hollow circle for Projects
    return (
      <div
        className={cn(dotSize, borderSize, "rounded-full flex-shrink-0", className)}
        style={{ borderColor: getProjectColor(color) }}
      />
    )
  }

  // Solid circle for Areas and Unassigned
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
export function getLabelIcon(color: string, options: IconOptions = {}): ReactNode {
  const { size = "md", className = "" } = options
  const sizeClass = ICON_SIZES[size]

  return (
    <Tag
      className={cn(sizeClass, className)}
      style={{ color: getProjectColor(color) }}
    />
  )
}
