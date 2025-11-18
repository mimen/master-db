import { CircleIcon, SquareIcon } from "@/components/icons/ProjectTypeIcons"
import type { ProjectTypeIconProps } from "@/components/icons/ProjectTypeIcons"
import type { TodoistProjectWithMetadata } from "@/types/convex/todoist"

/**
 * Project type as stored in the database.
 * These match the Todoist label names exactly.
 */
export type ProjectType = "area-of-responsibility" | "project-type"

/**
 * Icon component type for project types.
 */
export type ProjectTypeIconComponent = React.ComponentType<ProjectTypeIconProps>

/**
 * Display information for a project type.
 */
export interface ProjectTypeInfo {
  type: ProjectType
  label: string
  description: string
  icon: ProjectTypeIconComponent
}

/**
 * Map of project types to their display information.
 */
export const PROJECT_TYPE_MAP: Record<ProjectType, ProjectTypeInfo> = {
  "area-of-responsibility": {
    type: "area-of-responsibility",
    label: "Area",
    description: "Ongoing responsibility",
    icon: CircleIcon,
  },
  "project-type": {
    type: "project-type",
    label: "Project",
    description: "Finite work with an end",
    icon: SquareIcon,
  },
}

/**
 * Get display information for a project type.
 *
 * @param projectType - The project type from database
 * @returns Display info with label, description, and icon component
 *
 * @example
 * const info = getProjectTypeDisplay("area-of-responsibility")
 * console.log(info.label) // "Area"
 * const Icon = info.icon
 * return <Icon size="md" />
 */
export function getProjectTypeDisplay(projectType?: string): ProjectTypeInfo | null {
  if (!projectType) return null
  if (projectType !== "area-of-responsibility" && projectType !== "project-type") return null
  return PROJECT_TYPE_MAP[projectType]
}

/**
 * Get the icon component for a project type.
 *
 * @param projectType - The project type from database
 * @returns Icon component (CircleIcon or SquareIcon) or null
 *
 * @example
 * const Icon = getProjectTypeIcon("project-type")
 * return Icon ? <Icon size="sm" className="text-blue-500" /> : null
 */
export function getProjectTypeIcon(projectType?: string): ProjectTypeIconComponent | null {
  const info = getProjectTypeDisplay(projectType)
  return info ? info.icon : null
}

/**
 * Check if a project is an Area (ongoing responsibility).
 *
 * @param project - Project with metadata
 * @returns True if project type is "area-of-responsibility"
 *
 * @example
 * if (isArea(project)) {
 *   console.log("This is an ongoing area of responsibility")
 * }
 */
export function isArea(project: TodoistProjectWithMetadata): boolean {
  return project.metadata?.projectType === "area-of-responsibility"
}

/**
 * Check if a project is a Project (finite work).
 *
 * @param project - Project with metadata
 * @returns True if project type is "project-type"
 *
 * @example
 * if (isProject(project)) {
 *   console.log("This is a finite project")
 * }
 */
export function isProject(project: TodoistProjectWithMetadata): boolean {
  return project.metadata?.projectType === "project-type"
}

/**
 * Check if a project has no type assigned.
 *
 * @param project - Project with metadata
 * @returns True if project has no type (unassigned)
 *
 * @example
 * if (isUnassignedFolder(project)) {
 *   console.log("This project needs a type assigned")
 * }
 */
export function isUnassignedFolder(project: TodoistProjectWithMetadata): boolean {
  return !project.metadata?.projectType
}

/**
 * React hook for getting project type information with UI-friendly helpers.
 *
 * @param projectType - The project type from database
 * @returns Display info or null if no type
 *
 * @example
 * const typeInfo = useProjectType(project.metadata?.projectType)
 * if (typeInfo) {
 *   const Icon = typeInfo.icon
 *   return (
 *     <div>
 *       <Icon size="sm" />
 *       <span>{typeInfo.label}</span>
 *     </div>
 *   )
 * }
 */
export function useProjectType(projectType?: string): ProjectTypeInfo | null {
  return getProjectTypeDisplay(projectType)
}
