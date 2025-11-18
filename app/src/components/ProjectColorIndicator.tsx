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

/**
 * Centralized project color indicator that changes shape based on project type.
 *
 * - Areas (area-of-responsibility): Colored circle
 * - Projects (project-type): Colored square (sharp 90° corners)
 * - Unassigned: Colored circle (default)
 */
export function ProjectColorIndicator({ project, size = "md", className }: ProjectColorIndicatorProps) {
  const isProject = project.metadata?.projectType === "project-type"
  const sizeClass = SIZE_MAP[size]

  return (
    <div
      className={cn(
        sizeClass,
        "shrink-0",
        isProject ? "" : "rounded-full",
        className
      )}
      style={{ backgroundColor: getProjectColor(project.color) }}
    />
  )
}
