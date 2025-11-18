import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CollapsibleGroupHeaderProps {
  /**
   * Unique key for this group (used internally for collapse tracking)
   */
  groupKey: string

  /**
   * Display label for the group (e.g., "Project A", "P1", "High Priority")
   */
  label: string

  /**
   * Number of entities in this group
   */
  count: number

  /**
   * Whether this group is currently collapsed
   */
  isCollapsed: boolean

  /**
   * Callback when user clicks to toggle collapse state
   */
  onToggle: (groupKey: string) => void
}

/**
 * CollapsibleGroupHeader - Renders a collapsible group header with toggle icon
 *
 * Shows: chevron icon (rotated based on collapsed state), group label, entity count
 * Styling: subtle background, rounded corners, full-width clickable area
 */
export function CollapsibleGroupHeader({
  groupKey,
  label,
  count,
  isCollapsed,
  onToggle,
}: CollapsibleGroupHeaderProps) {
  return (
    <button
      onClick={() => onToggle(groupKey)}
      className={cn(
        "w-full flex items-center gap-2 px-2.5 py-2 mb-1",
        "text-sm font-medium text-foreground",
        "rounded-md border border-transparent",
        "hover:bg-accent/50 transition-colors",
        "focus:outline-none focus:bg-accent/50 focus:border-primary/30",
        "cursor-pointer text-left"
      )}
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? "Expand" : "Collapse"} group: ${label}`}
    >
      {/* Chevron Icon */}
      <ChevronDown
        className={cn(
          "h-4 w-4 flex-shrink-0 transition-transform duration-150",
          isCollapsed && "rotate-[-90deg]"
        )}
      />

      {/* Group Label */}
      <span className="flex-1 min-w-0">{label}</span>

      {/* Count Badge */}
      <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded shrink-0">
        {count}
      </span>
    </button>
  )
}
