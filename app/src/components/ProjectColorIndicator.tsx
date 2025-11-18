import { getProjectColor } from "@/lib/colors"
import { cn } from "@/lib/utils"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectColorIndicatorProps {
  project: Pick<TodoistProjectWithMetadata, "color" | "metadata">
  size?: "sm" | "md" | "lg"
  className?: string
}

const SIZE_MAP = {
  sm: "w-2.5 h-2.5",
  md: "w-3 h-3",
  lg: "w-4 h-4",
} as const

const BORDER_MAP = {
  sm: "border",
  md: "border-[1.5px]",
  lg: "border-2",
} as const

/**
 * Centralized project color indicator that changes style based on project type.
 *
 * - Areas (area-of-responsibility): Solid colored circle
 * - Projects (project-type): Hollow/outline colored circle
 * - Unassigned: Solid colored circle (default)
 */
export function ProjectColorIndicator({ project, size = "md", className }: ProjectColorIndicatorProps) {
  const isProject = project.metadata?.projectType === "project-type"
  const sizeClass = SIZE_MAP[size]
  const borderClass = BORDER_MAP[size]
  const color = getProjectColor(project.color)

  if (isProject) {
    // Hollow circle for Projects
    return (
      <div
        className={cn(
          sizeClass,
          borderClass,
          "rounded-full shrink-0",
          className
        )}
        style={{ borderColor: color }}
      />
    )
  }

  // Solid circle for Areas and Unassigned
  return (
    <div
      className={cn(
        sizeClass,
        "rounded-full shrink-0",
        className
      )}
      style={{ backgroundColor: color }}
    />
  )
}
