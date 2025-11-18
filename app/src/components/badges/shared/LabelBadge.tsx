import { X, Tag } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Label Badge - Pure view component for displaying labels/tags
 *
 * Entity-agnostic badge that displays label name with optional color.
 * Supports both clickable (edit) and removable (X button) patterns.
 * Parent is responsible for color computation - badge just receives CSS color value.
 *
 * @example
 * ```tsx
 * function TaskRow({ task }) {
 *   return task.labels.map((label) => (
 *     <LabelBadge
 *       key={label.id}
 *       label={{
 *         name: label.name,
 *         color: getLabelColor(label.color)  // Parent computed color
 *       }}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openLabelsDialog(task)
 *       }}
 *       onRemove={(e) => {
 *         e.stopPropagation()
 *         removeLabel(task.id, label.id)
 *       }}
 *     />
 *   ))
 * }
 * ```
 */

export interface LabelBadgeProps {
  /**
   * Label data: name and optional colors
   * Parent is responsible for computing the actual color values
   */
  label: {
    name: string
    borderColor?: string  // Optional: CSS color for border, hex, rgb, etc. Computed by parent.
    backgroundColor?: string  // Optional: CSS color for background (usually 8-10% opacity). Computed by parent.
  }

  /**
   * Click handler - called when badge body is clicked
   * Typically opens dialog to edit/view label
   * Parent should stopPropagation if needed
   */
  onClick?: (e: React.MouseEvent) => void

  /**
   * Remove handler - called when X button is clicked
   * If not provided, X button is not shown
   * Parent should stopPropagation if needed
   */
  onRemove?: (e: React.MouseEvent) => void

  /**
   * Ghost state styling - shows dashed border + muted text
   * Use when label is not set or should be "add" state
   */
  isGhost?: boolean
}

export function LabelBadge({
  label,
  onClick,
  onRemove,
  isGhost = false,
}: LabelBadgeProps) {
  const [isHovering, setIsHovering] = useState(false)

  // Apply colors if provided (border and background)
  const colorStyle = label.borderColor || label.backgroundColor ? {
    borderColor: label.borderColor,
    backgroundColor: label.backgroundColor
  } : undefined

  return (
    <Badge
      variant={isGhost ? "outline" : "secondary"}
      className={cn(
        "gap-1 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        !isGhost && "border",
        isGhost && "text-muted-foreground border-dashed"
      )}
      style={colorStyle}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <Tag className="h-3 w-3" />
      <span className="max-w-[150px] truncate">{label.name}</span>
      {onRemove && isHovering && !isGhost && (
        <button
          className="ml-0.5 hover:text-destructive transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(e)
          }}
          aria-label={`Remove ${label.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  )
}
