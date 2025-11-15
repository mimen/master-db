import { Flag, Inbox, Tag } from "lucide-react"

import { getViewIcon } from "../icons/viewIcons"

import type {
  ListDefinition,
  ListDependencies,
  ListInstance,
  ListInstanceOptions,
  ListPresentationContext,
  ListQueryInput,
  TimeRange,
} from "./types"

import { Badge } from "@/components/ui/badge"
import { getProjectColor } from "@/lib/colors"
import { getPriorityColorClass, getPriorityInfo } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { TodoistProjectsWithMetadata } from "@/types/convex/todoist"

function mergeDependencies(...deps: Array<ListDependencies | undefined>): ListDependencies {
  return deps.reduce<ListDependencies>((acc, dep) => {
    if (!dep) return acc
    if (dep.projects) acc.projects = true
    if (dep.projectMetadata) acc.projectMetadata = true
    if (dep.labels) acc.labels = true
    return acc
  }, {})
}

function createListInstance<P extends Record<string, unknown>>(
  definition: ListDefinition<P>,
  options: ListInstanceOptions<P>
): ListInstance<P> {
  const { id, params, overrides, viewKey, indexInView } = options
  const baseQuery = definition.buildQuery(params)
  const query: ListQueryInput = {
    ...baseQuery,
    view: viewKey,
  }
  const dependencies = mergeDependencies(definition.dependencies)

  const getHeader = (context: ListPresentationContext<P>) => {
    if (overrides?.getHeader) {
      return overrides.getHeader({ ...context, params })
    }
    return definition.getHeader(context)
  }

  const getEmptyState = (context: ListPresentationContext<P>) => {
    if (overrides?.getEmptyState) {
      return overrides.getEmptyState({ ...context, params })
    }
    return definition.getEmptyState(context)
  }

  return {
    id,
    viewKey,
    indexInView,
    definition,
    params,
    query,
    dependencies,
    collapsible: overrides?.collapsible ?? definition.defaults.collapsible,
    startExpanded: overrides?.startExpanded ?? definition.defaults.startExpanded,
    maxTasks: overrides?.maxTasks ?? definition.defaults.maxTasks,
    getHeader,
    getEmptyState,
  }
}

const inboxDefinition: ListDefinition = {
  key: "list:inbox",
  defaults: {
    collapsible: false,
    startExpanded: true,
  },
  dependencies: {
    projects: true,
    labels: true,
  },
  buildQuery: (): ListQueryInput => ({ type: "inbox" }),
  getHeader: ({ taskCount }) => ({
    title: "Inbox",
    description: `${taskCount} tasks to process`,
    icon: <Inbox className="h-6 w-6 mr-3" />,
  }),
  getEmptyState: () => ({
    title: "Inbox Zero!",
    description: "All tasks have been processed and moved to projects",
  }),
}

const timeRangeLabels: Record<TimeRange, { title: string; description: string }> = {
  overdue: {
    title: "Overdue",
    description: "overdue tasks",
  },
  today: {
    title: "Today",
    description: "tasks due today",
  },
  upcoming: {
    title: "Upcoming",
    description: "tasks due this week",
  },
  "no-date": {
    title: "No Date",
    description: "tasks without due dates",
  },
}

const timeDefinition: ListDefinition<{ range: TimeRange }> = {
  key: "list:time",
  defaults: {
    collapsible: true,
    startExpanded: true,
  },
  dependencies: {
    labels: true,
  },
  buildQuery: ({ range }): ListQueryInput => ({
    type: "time",
    range,
    timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1, // Convert to IANA format (PST is -480)
  }),
  getHeader: ({ taskCount, params }) => {
    const { title, description } = timeRangeLabels[params.range]
    const descriptionText = params.range === "upcoming"
      ? `${taskCount} upcoming tasks`
      : `${taskCount} ${description}`

    // Construct viewKey from params.range to get the correct icon
    const viewKey = `view:time:${params.range}` as const
    const icon = getViewIcon(viewKey, { size: "lg", className: "mr-3" })

    return {
      title,
      description: descriptionText,
      icon,
    }
  },
  getEmptyState: ({ params }) => {
    switch (params.range) {
      case "overdue":
        return {
          title: "Nothing overdue!",
          description: "No overdue tasks",
        }
      case "today":
        return {
          title: "All caught up!",
          description: "No tasks due today",
        }
      case "upcoming":
        return {
          title: "Nothing upcoming!",
          description: "No tasks due in the next 7 days",
        }
      case "no-date":
      default:
        return {
          title: "No tasks here!",
          description: "This view is empty",
        }
    }
  },
}

const projectDefinition: ListDefinition<{ projectId: string }> = {
  key: "list:project",
  defaults: {
    collapsible: true,
    startExpanded: true,
  },
  dependencies: {
    projects: true,
    projectMetadata: true,
    labels: true,
  },
  buildQuery: ({ projectId }): ListQueryInput => ({ type: "project", projectId }),
  getHeader: ({ taskCount, params, support }) => {
    const project = support.projects?.find((p) => p.todoist_id === params.projectId)
    const projectWithMetadata = support.projectsWithMetadata?.find(
      (p) => p.todoist_id === params.projectId
    )
    const title = project?.name ?? "Project"
    const description = `${taskCount} tasks in this project`

    const projectIcon = project ? (
      <div
        className="w-4 h-4 rounded-full mr-3 flex-shrink-0"
        style={{ backgroundColor: getProjectColor(project.color) }}
      />
    ) : null

    const metadata = projectWithMetadata?.metadata
    if (!metadata?.priority) {
      return {
        title,
        description,
        icon: projectIcon,
      }
    }

    const priorityInfo = getPriorityInfo(metadata.priority)
    const colorClass = getPriorityColorClass(metadata.priority)

    return {
      title: (
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {priorityInfo?.showFlag && (
            <Badge
              variant="outline"
              className={cn("gap-1.5 font-normal", colorClass)}
            >
              <Flag className="h-3 w-3" fill="currentColor" />
              <span>{priorityInfo.uiPriority}</span>
            </Badge>
          )}
        </div>
      ),
      description,
      icon: projectIcon,
    }
  },
  getEmptyState: () => ({
    title: "No tasks here!",
    description: "This project is empty",
  }),
}

const priorityDefinition: ListDefinition<{ level: 1 | 2 | 3 | 4 }> = {
  key: "list:priority",
  defaults: {
    collapsible: true,
    startExpanded: true,
  },
  dependencies: {
    labels: true,
  },
  buildQuery: ({ level }): ListQueryInput => ({ type: "priority", priority: level }),
  getHeader: ({ taskCount, params }) => {
    const priorityInfo = getPriorityInfo(params.level)
    const colorClass = getPriorityColorClass(params.level)
    const label = priorityInfo?.uiPriority ?? `P${params.level}`

    return {
      title: label,
      description: `${taskCount} tasks with ${label} priority`,
      icon: (
        <Flag className={cn("h-6 w-6 mr-3", colorClass)} fill="currentColor" />
      ),
    }
  },
  getEmptyState: ({ params }) => {
    const priorityInfo = getPriorityInfo(params.level)
    const label = priorityInfo?.uiPriority ?? `P${params.level}`
    return {
      title: "No tasks here!",
      description: `No ${label} tasks found`,
    }
  },
}

const labelDefinition: ListDefinition<{ label: string }> = {
  key: "list:label",
  defaults: {
    collapsible: true,
    startExpanded: true,
  },
  dependencies: {
    labels: true,
  },
  buildQuery: ({ label }): ListQueryInput => ({ type: "label", label }),
  getHeader: ({ taskCount, params, support }) => {
    const labelDoc = support.labels?.find((l) => l.name === params.label)

    return {
      title: `@${params.label}`,
      description: `${taskCount} tasks with @${params.label} label`,
      icon: labelDoc ? (
        <Tag
          className="h-6 w-6 mr-3"
          style={{ color: getProjectColor(labelDoc.color) }}
        />
      ) : (
        <Tag className="h-6 w-6 mr-3 text-muted-foreground" />
      ),
    }
  },
  getEmptyState: ({ params }) => ({
    title: "No tasks here!",
    description: `No tasks with @${params.label}`,
  }),
}

const projectsDefinition: ListDefinition = {
  key: "list:projects",
  defaults: {
    collapsible: false,
    startExpanded: true,
  },
  dependencies: {
    projectMetadata: true,
  },
  buildQuery: (): ListQueryInput => ({ type: "projects" }),
  getHeader: ({ taskCount }) => {
    const icon = getViewIcon("view:projects", { size: "lg", className: "mr-3" })

    return {
      title: "Projects",
      description: `${taskCount} active projects`,
      icon,
    }
  },
  getEmptyState: () => ({
    title: "No projects yet!",
    description: "Create your first project in Todoist",
  }),
}

const routinesDefinition: ListDefinition = {
  key: "list:routines",
  defaults: {
    collapsible: false,
    startExpanded: true,
  },
  buildQuery: (): ListQueryInput => ({ type: "routines" }),
  getHeader: ({ taskCount }) => {
    const icon = getViewIcon("view:routines", { size: "lg", className: "mr-3" })

    return {
      title: "Routines",
      description: `${taskCount} active routines`,
      icon,
    }
  },
  getEmptyState: () => ({
    title: "No routines yet!",
    description: "Create your first routine to automate recurring tasks",
  }),
}

export const listDefinitions = {
  inbox: inboxDefinition,
  time: timeDefinition,
  project: projectDefinition,
  priority: priorityDefinition,
  label: labelDefinition,
  projects: projectsDefinition,
  routines: routinesDefinition,
} as const

export type ListDefinitionKey = keyof typeof listDefinitions

export function instantiateList<P extends Record<string, unknown>>(
  definition: ListDefinition<P>,
  options: ListInstanceOptions<P>
): ListInstance<P> {
  return createListInstance(definition, options)
}

export function getProjectPriorityLevel(
  projectId: string,
  projectsWithMetadata?: TodoistProjectsWithMetadata
): number | null {
  if (!projectsWithMetadata) return null
  const found = projectsWithMetadata.find((p) => p.todoist_id === projectId)
  return found?.metadata?.priority ?? null
}

export type { ListInstance } from "./types"
