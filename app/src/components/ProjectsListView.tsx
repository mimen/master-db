import { useAction, useQuery } from "convex/react"
import { useCallback, useMemo } from "react"

import { BaseListView, ProjectListItem } from "@/components/list-items"
import { useFocusContext } from "@/contexts/FocusContext"
import { useOptimisticUpdates } from "@/contexts/OptimisticUpdatesContext"
import { api } from "@/convex/_generated/api"
import { useProjectDialogShortcuts } from "@/hooks/useProjectDialogShortcuts"
import type { ListInstance } from "@/lib/views/types"
import { projectSortOptions, projectGroupOptions } from "@/lib/views/entityConfigs/projectConfig"
import type { TodoistProjectsWithMetadata, TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectsListViewProps {
  list: ListInstance
  onProjectCountChange?: (listId: string, count: number) => void
  onProjectClick?: (listId: string, projectIndex: number) => void
  focusedProjectIndex: number | null
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean
}

export function ProjectsListView({
  list,
  onProjectCountChange,
  onProjectClick,
  focusedProjectIndex,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false
}: ProjectsListViewProps) {
  const { setFocusedProject } = useFocusContext()
  const { getProjectUpdate } = useOptimisticUpdates()

  // Fetch all projects
  const allProjects: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata,
    {}
  )

  const unarchiveProject = useAction(api.todoist.actions.unarchiveProject.unarchiveProject)

  const handleUnarchive = useCallback(async (projectId: string) => {
    await unarchiveProject({ projectId })
  }, [unarchiveProject])

  // Filter and sort projects (entity-specific logic stays in parent)
  // Sort by: archived status (active first), then priority, then alphabetically
  const projects = useMemo(() => {
    if (!allProjects) return []

    return allProjects
      .filter((p: TodoistProjectWithMetadata) => {
        // Always exclude deleted projects
        if (p.is_deleted) return false

        // Apply projectType filter if specified
        if (list.query.type === "projects" && list.query.projectType) {
          const projectType = p.metadata?.projectType

          if (list.query.projectType === "project-type") {
            return projectType === "project-type"
          } else if (list.query.projectType === "area-of-responsibility") {
            return projectType === "area-of-responsibility"
          } else if (list.query.projectType === "unassigned") {
            return !projectType
          }
        }

        return true
      })
      .sort((a: TodoistProjectWithMetadata, b: TodoistProjectWithMetadata) => {
        // Keep archived projects at the bottom
        if (a.is_archived !== b.is_archived) {
          return a.is_archived ? 1 : -1
        }

        // Check for optimistic priority updates
        const aOptimistic = getProjectUpdate(a.todoist_id)
        const bOptimistic = getProjectUpdate(b.todoist_id)

        const aPriority =
          aOptimistic?.type === "priority-change"
            ? aOptimistic.newPriority
            : a.metadata?.priority ?? 1
        const bPriority =
          bOptimistic?.type === "priority-change"
            ? bOptimistic.newPriority
            : b.metadata?.priority ?? 1

        // Sort by priority descending (4→3→2→1 means P1→P2→P3→P4)
        if (aPriority !== bPriority) {
          return bPriority - aPriority
        }

        // Then alphabetically by name
        return a.name.localeCompare(b.name)
      })
  }, [allProjects, getProjectUpdate, list.query])

  const visibleProjects = list.maxTasks ? projects.slice(0, list.maxTasks) : projects
  const isLoading = allProjects === undefined

  // BaseListView handles all list-level rendering (header, empty state, collapse, focus, count)
  return (
    <BaseListView<TodoistProjectWithMetadata>
      entities={visibleProjects}
      entityType="project"
      getEntityId={(project) => project.todoist_id}
      list={list}
      isMultiListView={isMultiListView}
      isDismissed={isDismissed}
      onDismiss={onDismiss}
      onRestore={onRestore}
      isLoading={isLoading}
      focusedIndex={focusedProjectIndex}
      setFocusedEntity={() => {}}
      setFocusedEntityInContext={setFocusedProject}
      useEntityShortcuts={useProjectDialogShortcuts}
      onEntityCountChange={onProjectCountChange}
      onEntityClick={onProjectClick}
      sortOptions={projectSortOptions}
      groupOptions={projectGroupOptions}
      groupData={{ projects: visibleProjects }}
      renderRow={(project, index, ref) => (
        <ProjectListItem
          key={project._id}
          project={project}
          onElementRef={ref}
          onClick={() => onProjectClick?.(list.id, index)}
          onUnarchive={handleUnarchive}
        />
      )}
    />
  )
}
