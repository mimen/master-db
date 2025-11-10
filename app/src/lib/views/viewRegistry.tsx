import { Filter, Inbox } from "lucide-react"

import { BUILT_IN_MULTI_LISTS } from "../multi-list/defaults"

import { instantiateList, listDefinitions } from "./listDefinitions"
import type {
  ListInstance,
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
  getDefinition: (extracted: Record<string, unknown>) => ViewDefinition
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
  overrides?: { collapsible?: boolean; startExpanded?: boolean }
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
  return [
    instantiateList(listDefinitions.priority, {
      id: createListId(viewKey, `p${level}`),
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

// View registry - maps view keys to their expansion logic
const viewPatterns: ViewPattern[] = [
  {
    match: (key) => key === "view:inbox",
    getDefinition: () => ({
      metadata: {
        title: "Inbox",
        icon: <Inbox className="h-4 w-4" />,
      },
      buildLists: (viewKey, index) => expandInbox(viewKey, index),
    }),
  },
  {
    match: (key) => key === "view:today",
    getDefinition: () => ({
      metadata: { title: "Today" },
      buildLists: (viewKey, index) =>
        expandTimeRange(viewKey, index, "today", { collapsible: false }),
    }),
  },
  {
    match: (key) => key === "view:upcoming",
    getDefinition: () => ({
      metadata: { title: "Upcoming" },
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

      return {
        metadata: { title },
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
        icon: <Filter className="h-4 w-4" />,
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
    match: (key) => key.startsWith("view:project:") && !key.includes("-family"),
    extract: (key) => ({
      projectId: key.replace("view:project:", ""),
    }),
    getDefinition: (extracted) => ({
      metadata: { title: "Project" },
      buildLists: (viewKey, index) =>
        expandProject(viewKey, index, extracted.projectId as string, {
          collapsible: false,
        }),
    }),
  },
  {
    match: (key) => key.startsWith("view:project-family:"),
    extract: (key) => ({
      projectId: key.replace("view:project-family:", ""),
    }),
    getDefinition: (extracted) => ({
      metadata: { title: "Project" },
      buildLists: (viewKey, index, context) =>
        expandProjectWithChildren(
          viewKey,
          index,
          context,
          extracted.projectId as string
        ),
    }),
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

      return {
        metadata: { title: `${priorityId.toUpperCase()} Projects` },
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

      return {
        metadata: { title: priorityId.toUpperCase() },
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
    getDefinition: (extracted) => ({
      metadata: { title: `@${extracted.labelName}` },
      buildLists: (viewKey, index) =>
        expandLabel(viewKey, index, extracted.labelName as string, {
          collapsible: false,
        }),
    }),
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
            const nestedDefinition = getViewDefinition(targetKey)

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
  viewKey: ViewKey
): ViewDefinition | null {
  for (const pattern of viewPatterns) {
    if (pattern.match(viewKey)) {
      const extracted = pattern.extract ? pattern.extract(viewKey) : {}
      return pattern.getDefinition(extracted)
    }
  }

  return null
}
