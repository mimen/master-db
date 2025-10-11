import { useQuery } from "convex/react"
import { useMemo } from "react"

import type { ProjectTreeNode } from "../types"
import { buildProjectTree } from "../utils/projectTree"

import { api } from "@/convex/_generated/api"
import type { ViewBuildContext } from "@/lib/views/types"
import type {
  TodoistLabelDoc,
  TodoistProjects,
  TodoistProjectsWithMetadata,
} from "@/types/convex/todoist"

export function useSidebarData() {
  const enhancedProjects = useQuery(api.todoist.publicQueries.getProjectsWithMetadata, {}) as
    | TodoistProjectsWithMetadata
    | undefined

  const basicProjects = useQuery(api.todoist.publicQueries.getProjects) as TodoistProjects | undefined

  const labels = useQuery(api.todoist.publicQueries.getLabels) as TodoistLabelDoc[] | undefined

  const timeFilterCounts = useQuery(api.todoist.publicQueries.getTimeFilterCounts, {})
  const priorityFilterCounts = useQuery(api.todoist.publicQueries.getPriorityFilterCounts, {})
  const labelFilterCounts = useQuery(api.todoist.publicQueries.getLabelFilterCounts, {})

  const projectsWithMetadata: TodoistProjectsWithMetadata | undefined =
    enhancedProjects && enhancedProjects.length > 0
      ? enhancedProjects
      : basicProjects
        ?.map((project) => ({
          ...project,
          metadata: {
            priority: 4,
            scheduledDate: null,
            description: null,
            sourceTaskId: null,
            lastUpdated: null,
          },
          stats: {
            itemCount: 0,
            activeCount: 0,
            completedCount: 0,
          },
          computed: {
            isScheduled: false,
            isHighPriority: false,
            completionRate: null,
            hasActiveItems: false,
          },
        }))

  const projectTree = projectsWithMetadata ? buildProjectTree(projectsWithMetadata) : []

  const inboxProject = projectsWithMetadata?.find(
    (project) => project.name === "Inbox" && !project.parent_id
  )

  const otherProjects = projectTree.filter((project) => project.todoist_id !== inboxProject?.todoist_id)

  const viewContext: ViewBuildContext = useMemo(
    () => ({
      projects: basicProjects,
      projectsWithMetadata,
      labels,
    }),
    [basicProjects, projectsWithMetadata, labels]
  )

  return {
    projectsWithMetadata,
    labels,
    timeFilterCounts,
    priorityFilterCounts,
    labelFilterCounts,
    projectTree: otherProjects as ProjectTreeNode[],
    inboxProject,
    viewContext,
  }
}
