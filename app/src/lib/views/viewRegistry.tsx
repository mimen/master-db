import { getProjectColor } from "../colors"
import { getProjectIcon, getViewIcon } from "../icons/viewIcons"
import { BUILT_IN_MULTI_LISTS } from "../multi-list/defaults"

import { instantiateList, listDefinitions } from "./listDefinitions"
import type {
  ListInstance,
  ListInstanceOverrides,
  RoutineTaskFilter,
  TimeRange,
  ViewBuildContext,
  ViewKey,
  ViewMetadata,
  TodoistProjects,
  TodoistProjectsWithMetadata,
} from "./types"

type ListBuilder = (
  viewKey: ViewKey,
  index: number,
  context: ViewBuildContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => ListInstance<any>[]

interface ViewDefinition {
  metadata: ViewMetadata
  buildLists: ListBuilder
}

interface ViewPattern {
  match: (viewKey: ViewKey) => boolean
  extract?: (viewKey: ViewKey) => Record<string, unknown>
  getDefinition: (extracted: Record<string, unknown>, context?: ViewBuildContext) => ViewDefinition
}

function createListId(viewKey: ViewKey, suffix: string | number): string {
  return `${viewKey}:${suffix}`
}

function normalizeViewKey(view: string): ViewKey {
  if (view.startsWith("view:")) {
    return view as ViewKey
  }
  if (view.startsWith("multi:")) {
    return `view:${view}` as ViewKey
  }
  return `view:${view}` as ViewKey
}

// Expansion functions - each builds a specific pattern of lists
function expandInbox(viewKey: ViewKey, startIndex: number): ListInstance[] {
  return [
    instantiateList(listDefinitions.inbox, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}

function expandProjects(viewKey: ViewKey, startIndex: number): ListInstance[] {
  return [
    instantiateList(listDefinitions.projects, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}

function expandProjectsOnly(viewKey: ViewKey, startIndex: number): ListInstance[] {
  return [
    instantiateList(listDefinitions.projectsOnly, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}

function expandAreasOnly(viewKey: ViewKey, startIndex: number): ListInstance[] {
  return [
    instantiateList(listDefinitions.areasOnly, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}

function expandUnassignedFolders(viewKey: ViewKey, startIndex: number): ListInstance[] {
  return [
    instantiateList(listDefinitions.unassignedFolders, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}

function expandRoutines(viewKey: ViewKey, startIndex: number): ListInstance[] {
  return [
    instantiateList(listDefinitions.routines, {
      id: createListId(viewKey, "main"),
      viewKey,
      indexInView: startIndex,
      params: {},
    }),
  ]
}

function expandTimeRange(
  viewKey: ViewKey,
  startIndex: number,
  range: TimeRange,
  overrides?: { collapsible?: boolean }
): ListInstance[] {
  return [
    instantiateList(listDefinitions.time, {
      id: createListId(viewKey, range),
      viewKey,
      indexInView: startIndex,
      params: { range },
      overrides,
    }),
  ]
}

function expandProject(
  viewKey: ViewKey,
  startIndex: number,
  projectId: string,
  overrides?: ListInstanceOverrides
): ListInstance[] {
  return [
    instantiateList(listDefinitions.project, {
      id: createListId(viewKey, `project-${projectId}`),
      viewKey,
      indexInView: startIndex,
      params: { projectId },
      overrides,
    }),
  ]
}

function expandRoutinesByProject(
  viewKey: ViewKey,
  startIndex: number,
  projectId: string,
  overrides?: ListInstanceOverrides
): ListInstance[] {
  return [
    instantiateList(listDefinitions.projectRoutines, {
      id: createListId(viewKey, `routines-${projectId}`),
      viewKey,
      indexInView: startIndex,
      params: { projectId },
      overrides,
    }),
  ]
}

function expandProjectWithChildren(
  viewKey: ViewKey,
  startIndex: number,
  context: ViewBuildContext,
  projectId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ListInstance<any>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lists: ListInstance<any>[] = []
  const projects = context.projects ?? []

  const parent = projects.find((p: TodoistProjects[number]) => p.todoist_id === projectId)
  if (parent) {
    lists.push(
      ...expandProject(viewKey, startIndex + lists.length, parent.todoist_id, {
        collapsible: true,
        startExpanded: true,
      })
    )
  }

  const children = projects
    .filter((p: TodoistProjects[number]) => p.parent_id === projectId)
    .sort((a: TodoistProjects[number], b: TodoistProjects[number]) => a.child_order - b.child_order)

  children.forEach((child: TodoistProjects[number]) => {
    lists.push(
      ...expandProject(viewKey, startIndex + lists.length, child.todoist_id, {
        collapsible: true,
        startExpanded: true,
      })
    )
  })

  return lists
}

function expandProjectsByPriority(
  viewKey: ViewKey,
  startIndex: number,
  context: ViewBuildContext,
  priorityLevel: 1 | 2 | 3 | 4
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ListInstance<any>[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lists: ListInstance<any>[] = []
  const projectsWithMetadata = context.projectsWithMetadata ?? []

  projectsWithMetadata
    .filter((p: TodoistProjectsWithMetadata[number]) => p.metadata?.priority === priorityLevel)
    .sort((a: TodoistProjectsWithMetadata[number], b: TodoistProjectsWithMetadata[number]) => a.child_order - b.child_order)
    .forEach((project: TodoistProjectsWithMetadata[number]) => {
      lists.push(
        ...expandProject(viewKey, startIndex + lists.length, project.todoist_id, {
          collapsible: true,
          startExpanded: true,
        })
      )
    })

  return lists
}

function expandPriority(
  viewKey: ViewKey,
  startIndex: number,
  level: 1 | 2 | 3 | 4,
  overrides?: { collapsible?: boolean }
): ListInstance[] {
  // Extract priority ID from viewKey (e.g., "view:priority:p1" -> "p1")
  const priorityId = viewKey.replace("view:priority:", "") as "p1" | "p2" | "p3" | "p4"

  return [
    instantiateList(listDefinitions.priority, {
      id: createListId(viewKey, priorityId),
      viewKey,
      indexInView: startIndex,
      params: { level },
      overrides,
    }),
  ]
}

function expandLabel(
  viewKey: ViewKey,
  startIndex: number,
  label: string,
  overrides?: { collapsible?: boolean }
): ListInstance[] {
  return [
    instantiateList(listDefinitions.label, {
      id: createListId(viewKey, `label-${label}`),
      viewKey,
      indexInView: startIndex,
      params: { label },
      overrides,
    }),
  ]
}

function expandRoutineTask(
  viewKey: ViewKey,
  startIndex: number,
  filter: RoutineTaskFilter,
  overrides?: { collapsible?: boolean }
): ListInstance[] {
  return [
    instantiateList(listDefinitions.routineTasks, {
      id: createListId(viewKey, filter),
      viewKey,
      indexInView: startIndex,
      params: { filter },
      overrides,
    }),
  ]
}

// View registry - maps view keys to their expansion logic
const viewPatterns: ViewPattern[] = [
  {
    match: (key) => key === "view:inbox",
    getDefinition: () => ({
      metadata: {
        title: "Inbox",
        icon: getViewIcon("view:inbox", { size: "sm" }),
      },
      buildLists: (viewKey, index) => expandInbox(viewKey, index),
    }),
  },
  {
    match: (key) => key === "view:today",
    getDefinition: () => ({
      metadata: {
        title: "Today",
        icon: getViewIcon("view:today", { size: "sm" }),
      },
      buildLists: (viewKey, index) =>
        expandTimeRange(viewKey, index, "today", { collapsible: false }),
    }),
  },
  {
    match: (key) => key === "view:upcoming",
    getDefinition: () => ({
      metadata: {
        title: "Upcoming",
        icon: getViewIcon("view:upcoming", { size: "sm" }),
      },
      buildLists: (viewKey, index) =>
        expandTimeRange(viewKey, index, "upcoming", { collapsible: false }),
    }),
  },
  {
    match: (key) => key.startsWith("view:time:"),
    extract: (key) => {
      const range = key.split(":").slice(-1)[0] as TimeRange
      return { range }
    },
    getDefinition: (extracted) => {
      const range = extracted.range as TimeRange
      const title = range === "no-date"
        ? "No Date"
        : range.charAt(0).toUpperCase() + range.slice(1)
      const viewKey = `view:time:${range}` as ViewKey

      return {
        metadata: {
          title,
          icon: getViewIcon(viewKey, { size: "sm" }),
        },
        buildLists: (viewKey, index) =>
          expandTimeRange(viewKey, index, range, { collapsible: false }),
      }
    },
  },
  {
    match: (key) => key === "view:priority-queue",
    getDefinition: () => ({
      metadata: {
        title: "Priority Queue",
        icon: getViewIcon("view:priority-queue", { size: "sm" }),
      },
      buildLists: (viewKey, index, context) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lists: ListInstance<any>[] = []
        let currentIndex = index

        lists.push(...expandTimeRange(viewKey, currentIndex++, "overdue"))
        lists.push(...expandTimeRange(viewKey, currentIndex++, "today"))
        lists.push(...expandInbox(viewKey, currentIndex++))
        lists.push(...expandPriority(viewKey, currentIndex++, 4))

        const priorityProjects = context.projectsWithMetadata
        if (priorityProjects) {
          const sortedProjects = [...priorityProjects].sort(
            (a: TodoistProjectsWithMetadata[number], b: TodoistProjectsWithMetadata[number]) => a.child_order - b.child_order
          )

          sortedProjects
            .filter((p: TodoistProjectsWithMetadata[number]) => p.metadata?.priority === 4)
            .forEach((project: TodoistProjectsWithMetadata[number]) => {
              lists.push(
                ...expandProject(viewKey, currentIndex++, project.todoist_id, {
                  collapsible: true,
                })
              )
            })

          sortedProjects
            .filter((p: TodoistProjectsWithMetadata[number]) => p.metadata?.priority === 3)
            .forEach((project: TodoistProjectsWithMetadata[number]) => {
              lists.push(
                ...expandProject(viewKey, currentIndex++, project.todoist_id, {
                  collapsible: true,
                })
              )
            })
        }

        lists.push(...expandTimeRange(viewKey, currentIndex++, "upcoming"))

        // Fix indexInView for all lists
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lists.forEach((list: ListInstance<any>, i: number) => {
          list.indexInView = i
        })

        return lists
      },
    }),
  },
  {
    match: (key) => key === "view:projects",
    getDefinition: () => ({
      metadata: {
        title: "Projects",
        icon: getViewIcon("view:projects", { size: "sm" }),
      },
      buildLists: (viewKey, startIndex) => {
        return expandProjects(viewKey, startIndex)
      },
    }),
  },
  {
    match: (key) => key === "view:folders",
    getDefinition: () => ({
      metadata: {
        title: "Folders",
        icon: getViewIcon("view:folders", { size: "sm" }),
      },
      buildLists: (viewKey, startIndex) => {
        return expandProjects(viewKey, startIndex)
      },
    }),
  },
  {
    match: (key) => key === "view:folders:projects",
    getDefinition: () => ({
      metadata: {
        title: "Projects",
        icon: getViewIcon("view:folders:projects", { size: "sm" }),
      },
      buildLists: (viewKey, startIndex) => {
        return expandProjectsOnly(viewKey, startIndex)
      },
    }),
  },
  {
    match: (key) => key === "view:folders:areas",
    getDefinition: () => ({
      metadata: {
        title: "Areas",
        icon: getViewIcon("view:folders:areas", { size: "sm" }),
      },
      buildLists: (viewKey, startIndex) => {
        return expandAreasOnly(viewKey, startIndex)
      },
    }),
  },
  {
    match: (key) => key === "view:folders:unassigned",
    getDefinition: () => ({
      metadata: {
        title: "Unassigned Folders",
        icon: getViewIcon("view:folders:unassigned", { size: "sm" }),
      },
      buildLists: (viewKey, startIndex) => {
        return expandUnassignedFolders(viewKey, startIndex)
      },
    }),
  },
  {
    match: (key) => key === "view:routines",
    getDefinition: () => ({
      metadata: {
        title: "Routines",
        icon: getViewIcon("view:routines", { size: "sm" }),
      },
      buildLists: (viewKey, startIndex) => {
        return expandRoutines(viewKey, startIndex)
      },
    }),
  },
  {
    match: (key) => key.startsWith("view:routines:project:"),
    extract: (key) => ({
      projectId: key.replace("view:routines:project:", ""),
    }),
    getDefinition: (extracted, context) => {
      const projectId = extracted.projectId as string
      const projects = context?.projects ?? []
      const project = projects.find((p: TodoistProjects[number]) => p.todoist_id === projectId)

      return {
        metadata: {
          title: project?.name ? `${project.name} - Routines` : "Routines",
          icon: project ? getProjectIcon(project.color, { size: "sm" }) : getViewIcon("view:routines", { size: "sm" }),
        },
        buildLists: (viewKey, startIndex) => {
          return expandRoutinesByProject(viewKey, startIndex, projectId, {
            collapsible: false,
          })
        },
      }
    },
  },
  {
    match: (key) => key.startsWith("view:project:") && !key.includes("-family"),
    extract: (key) => ({
      projectId: key.replace("view:project:", ""),
    }),
    getDefinition: (extracted, context) => {
      const projectId = extracted.projectId as string
      const projects = context?.projectsWithMetadata ?? context?.projects ?? []
      const project = projects.find((p) => p.todoist_id === projectId)

      return {
        metadata: {
          title: project?.name ?? "Project",
          icon: project ? getProjectIcon(project.color, { size: "sm" }) : undefined
        },
        buildLists: (viewKey) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lists: ListInstance<any>[] = []

          // Tasks list (non-collapsible, primary content)
          lists.push(...expandProject(viewKey, 0, projectId, {
            collapsible: false,
            getHeader: (ctx) => {
              const projectWithMetadata = ctx.support.projectsWithMetadata?.find(p => p.todoist_id === projectId)
              const projectIcon = projectWithMetadata ? (
                <div
                  className="w-4 h-4 rounded-full mr-3 flex-shrink-0"
                  style={{ backgroundColor: getProjectColor(projectWithMetadata.color) }}
                />
              ) : null

              return {
                title: "Tasks",
                description: `${ctx.taskCount} tasks in this project`,
                icon: projectIcon,
              }
            }
          }))

          // Routines list (collapsible, secondary content)
          lists.push(...expandRoutinesByProject(viewKey, 1, projectId, {
            collapsible: true,
            startExpanded: true,
          }))

          return lists
        },
      }
    },
  },
  {
    match: (key) => key.startsWith("view:project-family:"),
    extract: (key) => ({
      projectId: key.replace("view:project-family:", ""),
    }),
    getDefinition: (extracted, context) => {
      const projectId = extracted.projectId as string
      const projects = context?.projectsWithMetadata ?? context?.projects ?? []
      const project = projects.find((p) => p.todoist_id === projectId)

      return {
        metadata: {
          title: project?.name ?? "Project",
          icon: project ? getProjectIcon(project.color, { size: "sm" }) : undefined
        },
        buildLists: (viewKey, index, context) =>
          expandProjectWithChildren(
            viewKey,
            index,
            context,
            projectId
          ),
      }
    },
  },
  {
    match: (key) => key.startsWith("view:priority-projects:"),
    extract: (key) => {
      const priorityId = key.replace("view:priority-projects:", "") as
        | "p1"
        | "p2"
        | "p3"
        | "p4"
      return { priorityId }
    },
    getDefinition: (extracted) => {
      const priorityId = extracted.priorityId as "p1" | "p2" | "p3" | "p4"
      const priorityLevel =
        priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1
      const viewKey = `view:priority-projects:${priorityId}` as ViewKey

      return {
        metadata: {
          title: `${priorityId.toUpperCase()} Projects`,
          icon: getViewIcon(viewKey, { size: "sm" }),
        },
        buildLists: (viewKey, index, context) =>
          expandProjectsByPriority(viewKey, index, context, priorityLevel),
      }
    },
  },
  {
    match: (key) => key.startsWith("view:priority:"),
    extract: (key) => {
      const priorityId = key.replace("view:priority:", "") as "p1" | "p2" | "p3" | "p4"
      return { priorityId }
    },
    getDefinition: (extracted) => {
      const priorityId = extracted.priorityId as "p1" | "p2" | "p3" | "p4"
      const level = priorityId === "p1" ? 4 : priorityId === "p2" ? 3 : priorityId === "p3" ? 2 : 1
      const viewKey = `view:priority:${priorityId}` as ViewKey

      return {
        metadata: {
          title: priorityId.toUpperCase(),
          icon: getViewIcon(viewKey, { size: "sm" }),
        },
        buildLists: (viewKey, index) =>
          expandPriority(viewKey, index, level, { collapsible: false }),
      }
    },
  },
  {
    match: (key) => key.startsWith("view:label:"),
    extract: (key) => ({
      labelName: key.replace("view:label:", ""),
    }),
    getDefinition: (extracted, context) => {
      const labelName = extracted.labelName as string
      const viewKey = `view:label:${labelName}` as ViewKey

      // Look up label color from context
      const labels = context?.labels ?? []
      const label = labels.find((l) => l.name === labelName)

      return {
        metadata: {
          title: `@${labelName}`,
          icon: getViewIcon(viewKey, { size: "sm", color: label?.color }),
        },
        buildLists: (viewKey, index) =>
          expandLabel(viewKey, index, labelName, {
            collapsible: false,
          }),
      }
    },
  },
  {
    match: (key) => key.startsWith("view:routine-tasks:"),
    extract: (key) => ({
      filter: key.replace("view:routine-tasks:", "") as RoutineTaskFilter,
    }),
    getDefinition: (extracted) => {
      const filter = extracted.filter as RoutineTaskFilter
      const viewKey = `view:routine-tasks:${filter}` as ViewKey

      const routineTaskLabels: Record<RoutineTaskFilter, string> = {
        overdue: "Overdue Routines",
        morning: "Morning Routine",
        night: "Night Routine",
        todays: "Ready to Go",
        "get-ahead": "Get Ahead",
      }

      return {
        metadata: {
          title: routineTaskLabels[filter],
          icon: getViewIcon(viewKey, { size: "sm" }),
        },
        buildLists: (viewKey, index) =>
          expandRoutineTask(viewKey, index, filter, { collapsible: false }),
      }
    },
  },
  {
    match: (key) => key.startsWith("view:multi:"),
    extract: (key) => ({
      multiId: key.replace("view:multi:", ""),
    }),
    getDefinition: (extracted) => {
      const multiId = extracted.multiId as string
      const multi = BUILT_IN_MULTI_LISTS.find((list) => list.id === multiId)

      if (!multi) {
        return {
          metadata: { title: "Unknown Multi-List" },
          buildLists: () => [],
        }
      }

      return {
        metadata: {
          title: multi.name,
          icon: multi.icon,
          description: multi.description,
        },
        buildLists: (viewKey, _index, context) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lists: ListInstance<any>[] = []

          multi.sequence.forEach((item, sequenceIndex) => {
            const targetKey = normalizeViewKey(item.view)
            const nestedDefinition = getViewDefinition(targetKey, context)

            if (!nestedDefinition) {
              return
            }

            const nestedLists = nestedDefinition.buildLists(targetKey, 0, context)

            nestedLists.forEach((nestedList) => {
              const customHeader = (ctx: Parameters<typeof nestedList.getHeader>[0]) => {
                const base = nestedList.getHeader(ctx)
                return {
                  ...base,
                  title: item.name ?? base.title,
                  icon: item.icon ?? base.icon,
                }
              }

              const nextList = {
                ...nestedList,
                id: createListId(viewKey, `${sequenceIndex}-${nestedList.id}`),
                viewKey,
                indexInView: lists.length,
                maxTasks: item.maxTasks ?? nestedList.maxTasks,
                getHeader: customHeader,
              }

              lists.push(nextList)
            })
          })

          return lists
        },
      }
    },
  },
]

export function getViewDefinition(
  viewKey: ViewKey,
  context?: ViewBuildContext
): ViewDefinition | null {
  for (const pattern of viewPatterns) {
    if (pattern.match(viewKey)) {
      const extracted = pattern.extract ? pattern.extract(viewKey) : {}
      return pattern.getDefinition(extracted, context)
    }
  }

  return null
}
