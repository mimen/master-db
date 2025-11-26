import { Badge } from "@/components/ui/badge"
import { getProjectTypeIcon } from "@/lib/projectTypes"
import { cn } from "@/lib/utils"
import type { ProjectType } from "@/lib/projectTypes"

/**
 * Project Type Badge - Pure view component for displaying project type (Area vs Project)
 *
 * Displays Circle icon for Areas, Square icon for Projects.
 * Ghost state for unassigned projects (no type set).
 *
 * @example
 * ```tsx
 * function ProjectRow({ project }) {
 *   const projectType = project.metadata?.projectType
 *
 *   return (
 *     <ProjectTypeBadge
 *       projectType={projectType}
 *       onClick={(e) => {
 *         e.stopPropagation()
 *         openProjectTypeDialog(project)
 *       }}
 *       isGhost={!projectType}
 *     />
 *   )
 * }
 * ```
 */

export interface ProjectTypeBadgeProps {
  /**
   * Project type: "area-of-responsibility" or "project-type"
   * undefined means unassigned/no type
   */
  projectType: ProjectType | undefined

  /**
   * Click handler - called when badge is clicked
   * Parent should stopPropagation if needed
   */
  onClick: (e: React.MouseEvent) => void

  /**
   * Ghost state styling - shows dashed border + muted text
   * Use when projectType is undefined (unassigned)
   */
  isGhost?: boolean
}

export function ProjectTypeBadge({
  projectType,
  onClick,
  isGhost = false,
}: ProjectTypeBadgeProps) {
  const Icon = projectType ? getProjectTypeIcon(projectType) : null
  const label = projectType === "area-of-responsibility"
    ? "Area"
    : projectType === "project-type"
    ? "Project"
    : "Set type"

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-normal cursor-pointer hover:bg-accent/80 transition-colors",
        isGhost && "text-muted-foreground border-dashed"
      )}
      onClick={onClick}
    >
      {Icon && <Icon size="sm" />}
      <span>{label}</span>
    </Badge>
  )
}
