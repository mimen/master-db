import { useAction, useQuery } from "convex/react"
import { useCallback, useMemo } from "react"

import { BaseListView, ProjectListItem } from "@/components/list-items"
import { useFocusContext } from "@/contexts/FocusContext"
import { api } from "@/convex/_generated/api"
import { useProjectDialogShortcuts } from "@/hooks/useProjectDialogShortcuts"
import type { ListInstance } from "@/lib/views/types"
import { projectSortOptions, projectGroupOptions } from "@/lib/views/entityConfigs/projectConfig"
import type { TodoistProjectsWithMetadata, TodoistProjectWithMetadata } from "@/types/convex/todoist"

interface ProjectsListViewProps {
  list: ListInstance
  onProjectCountChange?: (listId: string, count: number) => void
  onProjectClick?: (listId: string, entityId: string) => void
  focusedEntityId: string | null
  onEntityRemoved?: (listId: string, entityId: string) => void
  onEntitiesChange?: (listId: string, entities: unknown[]) => void
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean
}

export function ProjectsListView({
  list,
  onProjectCountChange,
  onProjectClick,
  focusedEntityId,
  onEntityRemoved,
  onEntitiesChange,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false
}: ProjectsListViewProps) {
  const { setFocusedProject } = useFocusContext()

  // Fetch all projects
  const allProjects: TodoistProjectsWithMetadata | undefined = useQuery(
    api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata,
    {}
  )

  const unarchiveProject = useAction(api.todoist.actions.unarchiveProject.unarchiveProject)

  const handleUnarchive = useCallback(async (projectId: string) => {
    await unarchiveProject({ projectId })
  }, [unarchiveProject])

  // Filter projects (sorting is handled by BaseListView via sortOptions)
  const projects = useMemo(() => {
    if (!allProjects) return []

    return allProjects.filter((p: TodoistProjectWithMetadata) => {
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
  }, [allProjects, list.query])

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
      focusedEntityId={focusedEntityId}
      onEntityRemoved={onEntityRemoved}
      setFocusedEntity={() => {}}
      setFocusedEntityInContext={setFocusedProject}
      useEntityShortcuts={useProjectDialogShortcuts}
      onEntityCountChange={onProjectCountChange}
      onEntitiesChange={onEntitiesChange}
      onEntityClick={onProjectClick}
      sortOptions={projectSortOptions}
      groupOptions={projectGroupOptions}
      groupData={{ projects: visibleProjects }}
      renderRow={(project, index, ref) => (
        <ProjectListItem
          key={project._id}
          project={project}
          onElementRef={ref}
          onClick={() => onProjectClick?.(list.id, project.todoist_id)}
          onUnarchive={handleUnarchive}
        />
      )}
    />
  )
}
