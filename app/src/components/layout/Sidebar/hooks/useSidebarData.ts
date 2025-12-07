import { useQuery } from "convex/react"
import { useMemo } from "react"

import { buildProjectTree } from "../utils/projectTree"

import { api } from "@/convex/_generated/api"
import type { ViewBuildContext, ProjectTreeNode } from "@/lib/views/types"
import type {
  TodoistLabelDoc,
  TodoistProjects,
  TodoistProjectsWithMetadata,
} from "@/types/convex/todoist"

export function useSidebarData() {
  const enhancedProjects = useQuery(api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata, {}) as
    | TodoistProjectsWithMetadata
    | undefined

  const basicProjects = useQuery(api.todoist.queries.getProjects.getProjects) as TodoistProjects | undefined

  const labels = useQuery(api.todoist.queries.getLabels.getLabels) as TodoistLabelDoc[] | undefined

  const timeFilterCounts = useQuery(api.todoist.queries.getTimeFilterCounts.getTimeFilterCounts, {})
  const priorityFilterCounts = useQuery(api.todoist.queries.getPriorityFilterCounts.getPriorityFilterCounts, {})
  const labelFilterCounts = useQuery(api.todoist.queries.getLabelFilterCounts.getLabelFilterCounts, {})

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

  // Filter out Inbox from projectsWithMetadata for use in Folders section
  const projectsExcludingInbox = projectsWithMetadata?.filter(
    (project) => !(project.name === "Inbox" && !project.parent_id)
  )

  const viewContext: ViewBuildContext = useMemo(
    () => ({
      projects: basicProjects,
      projectsWithMetadata,
      projectsExcludingInbox,
      labels,
      projectTree: otherProjects as ProjectTreeNode[],
    }),
    [basicProjects, projectsWithMetadata, projectsExcludingInbox, labels, otherProjects]
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
