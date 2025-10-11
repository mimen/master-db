import { Filter, Inbox } from "lucide-react"

import { instantiateList, listDefinitions } from "./listDefinitions"
import type {
  ListInstance,
  ListInstanceOverrides,
  TimeRange,
  ViewBuildContext,
  ViewKey,
  ViewMetadata,
  ViewSelection,
} from "./types"

function createListId(viewKey: ViewKey, suffix: string | number): string {
  return `${viewKey}:${suffix}`
}

function buildTimeList(
  viewKey: ViewKey,
  range: TimeRange,
  index: number,
  overrides?: ListInstanceOverrides<{ range: TimeRange }>
): ListInstance {
  return instantiateList(listDefinitions.time, {
    id: createListId(viewKey, range),
    viewKey,
    indexInView: index,
    params: { range },
    overrides,
  })
}

function buildInboxList(viewKey: ViewKey, index: number): ListInstance {
  return instantiateList(listDefinitions.inbox, {
    id: createListId(viewKey, "inbox"),
    viewKey,
    indexInView: index,
    params: {},
  })
}

function buildPriorityList(
  viewKey: ViewKey,
  index: number,
  level: 1 | 2 | 3 | 4,
  overrides?: ListInstanceOverrides<{ level: 1 | 2 | 3 | 4 }>
): ListInstance {
  return instantiateList(listDefinitions.priority, {
    id: createListId(viewKey, `p${level}`),
    viewKey,
    indexInView: index,
    params: { level },
    overrides,
  })
}

function buildProjectList(
  viewKey: ViewKey,
  index: number,
  projectId: string,
  overrides?: ListInstanceOverrides<{ projectId: string }>
): ListInstance {
  return instantiateList(listDefinitions.project, {
    id: createListId(viewKey, `project-${projectId}`),
    viewKey,
    indexInView: index,
    params: { projectId },
    overrides,
  })
}

function buildLabelList(
  viewKey: ViewKey,
  index: number,
  label: string,
  overrides?: ListInstanceOverrides<{ label: string }>
): ListInstance {
  return instantiateList(listDefinitions.label, {
    id: createListId(viewKey, `label-${label}`),
    viewKey,
    indexInView: index,
    params: { label },
    overrides,
  })
}

export function resolveView(
  viewKey: ViewKey,
  context: ViewBuildContext = {}
): ViewSelection {
  const lists: ListInstance[] = []
  const metadata: ViewMetadata = {
    title: "View",
  }

  const push = (list: ListInstance) => {
    lists.push(list)
  }

  switch (true) {
    case viewKey === "view:inbox": {
      metadata.title = "Inbox"
      metadata.icon = <Inbox className="h-4 w-4" />
      push(
        instantiateList(listDefinitions.inbox, {
          id: createListId(viewKey, "main"),
          viewKey,
          indexInView: 0,
          params: {},
        })
      )
      break
    }
    case viewKey === "view:today": {
      metadata.title = "Today"
      push(buildTimeList(viewKey, "today", 0, { collapsible: false }))
      break
    }
    case viewKey === "view:upcoming": {
      metadata.title = "Upcoming"
      push(buildTimeList(viewKey, "upcoming", 0, { collapsible: false }))
      break
    }
    case viewKey.startsWith("view:time:"): {
      const range = viewKey.split(":").slice(-1)[0] as TimeRange
      metadata.title = range === "no-date" ? "No Date" : range.charAt(0).toUpperCase() + range.slice(1)
      push(buildTimeList(viewKey, range, 0, { collapsible: false }))
      break
    }
    case viewKey === "view:priority-queue": {
      metadata.title = "Priority Queue"
      metadata.icon = <Filter className="h-4 w-4" />

      push(buildTimeList(viewKey, "overdue", lists.length))
      push(buildTimeList(viewKey, "today", lists.length))
      push(buildInboxList(viewKey, lists.length))
      push(buildPriorityList(viewKey, lists.length, 4))

      const priorityProjects = context.projectsWithMetadata

      if (priorityProjects) {
        const sortedProjects = [...priorityProjects].sort(
          (a, b) => a.child_order - b.child_order
        )

        sortedProjects
          .filter((project) => project.metadata?.priority === 4)
          .forEach((project) => {
            push(
              buildProjectList(viewKey, lists.length, project.todoist_id, {
                collapsible: true,
              })
            )
          })

        sortedProjects
          .filter((project) => project.metadata?.priority === 3)
          .forEach((project) => {
            push(
              buildProjectList(viewKey, lists.length, project.todoist_id, {
                collapsible: true,
              })
            )
          })
      }

      push(buildTimeList(viewKey, "upcoming", lists.length))
      break
    }
    case viewKey.startsWith("view:project:"): {
      const projectId = viewKey.replace("view:project:", "")
      metadata.title = "Project"
      push(
        buildProjectList(viewKey, 0, projectId, {
          collapsible: false,
        })
      )
      break
    }
    case viewKey.startsWith("view:project-family:"): {
      const projectId = viewKey.replace("view:project-family:", "")
      metadata.title = "Project"

      const projects = context.projects ?? []
      const parent = projects.find((project) => project.todoist_id === projectId)
      if (parent) {
        push(
          buildProjectList(viewKey, lists.length, parent.todoist_id, {
            collapsible: true,
            startExpanded: true,
          })
        )
      }

      const children = projects
        .filter((project) => project.parent_id === projectId)
        .sort((a, b) => a.child_order - b.child_order)

      children.forEach((child) => {
        push(
          buildProjectList(viewKey, lists.length, child.todoist_id, {
            collapsible: true,
            startExpanded: true,
          })
        )
      })
      break
    }
    case viewKey.startsWith("view:priority-projects:"): {
      const priorityId = viewKey.replace("view:priority-projects:", "") as "p1" | "p2" | "p3" | "p4"
      metadata.title = `Priority ${priorityId.toUpperCase()}`

      const priorityLevel = priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1
      const projectsWithMetadata = context.projectsWithMetadata ?? []

      projectsWithMetadata
        .filter((project) => project.metadata?.priority === priorityLevel)
        .sort((a, b) => a.child_order - b.child_order)
        .forEach((project) => {
          push(
            buildProjectList(viewKey, lists.length, project.todoist_id, {
              collapsible: true,
              startExpanded: true,
            })
          )
        })

      break
    }
    case viewKey.startsWith("view:priority:"): {
      const priorityId = viewKey.replace("view:priority:", "") as "p1" | "p2" | "p3" | "p4"
      metadata.title = priorityId.toUpperCase()
      const level = priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1
      push(
        buildPriorityList(viewKey, 0, level, {
          collapsible: false,
        })
      )
      break
    }
    case viewKey.startsWith("view:label:"): {
      const labelName = viewKey.replace("view:label:", "")
      metadata.title = `@${labelName}`
      push(
        buildLabelList(viewKey, 0, labelName, {
          collapsible: false,
        })
      )
      break
    }
    default: {
      throw new Error(`Unsupported view key: ${viewKey}`)
    }
  }

  return {
    key: viewKey,
    metadata,
    lists,
  }
}
