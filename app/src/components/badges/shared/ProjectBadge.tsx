import { Folder } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Project Badge - Pure view component for displaying project information
 *
 * Entity-agnostic badge that displays project name with colored dot.
 * Receives generic project data - works with tasks, projects, routines, etc.
 * Parent handles color computation - badge just receives computed color value.
 *
 * @example
 * ```tsx
 * function TaskRow({ task }) {
 *   const projectColor = getProjectColor(task.project.color)
 *
 *   return (
 *     <ProjectBadge
 *       project={{
 *         name: task.project.name,
 *         color: projectColor  // Parent computed the color
 *       }}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openProjectDialog(task)
 *       }}
 *     />
 *   )
 * }
 * ```
 */

export interface ProjectBadgeProps {
  /**
   * Project data: just name and computed color
   * Parent is responsible for computing the actual color value
   */
  project: {
    name: string
    color: string  // Computed color from parent (CSS color, hex, etc)
  }

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Ghost state styling - shows dashed border + muted text
   * Use when project is not set or should be "add" state
   */
  isGhost?: boolean
}

export function ProjectBadge({
  project,
  onClick,
  isGhost = false,
}: ProjectBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        isGhost && "text-muted-foreground border-dashed"
      )}
      onClick={onClick}
    >
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: project.color }}
      />
      <span>{project.name}</span>
    </Badge>
  )
}
