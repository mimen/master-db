import { useQuery } from "convex/react"
import {
  AlertCircle,
  ArrowDownAZ,
  Calendar,
  Filter,
  Flag,
  Hash,
  Inbox,
  Network,
  Plus,
  Tag,
} from "lucide-react"
import { useMemo, useState } from "react"
import type { ComponentType } from "react"

import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import type {
  TodoistLabelDoc,
  TodoistProjects,
  TodoistProjectsWithMetadata,
  TodoistProjectWithMetadata,
} from "@/types/convex/todoist"

interface SidebarProps {
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
}

type ProjectTreeNode = TodoistProjectWithMetadata & { children: ProjectTreeNode[] }

type ProjectSort = "hierarchy" | "priority" | "taskCount" | "alphabetical"
type LabelSort = "taskCount" | "alphabetical"

type ViewNavItem = {
  key: ViewKey
  label: string
  icon: ComponentType<{ className?: string }>
  count?: number | null
}

function flattenProjects(projects: ProjectTreeNode[]): ProjectTreeNode[] {
  const result: ProjectTreeNode[] = []

  function flatten(nodes: ProjectTreeNode[]) {
    for (const node of nodes) {
      result.push({ ...node, children: [] })
      if (node.children.length > 0) {
        flatten(node.children)
      }
    }
  }

  flatten(projects)
  return result
}

function getSortedProjects(
  projects: ProjectTreeNode[],
  sortMode: ProjectSort
): ProjectTreeNode[] {
  if (!projects) return []

  switch (sortMode) {
    case "hierarchy":
      return projects
    case "priority": {
      const flat = flattenProjects(projects)
      return flat.sort((a, b) => {
        const priorityA = a.metadata?.priority || 1
        const priorityB = b.metadata?.priority || 1
        return priorityB - priorityA
      })
    }
    case "taskCount": {
      const flat = flattenProjects(projects)
      return flat.sort((a, b) => b.stats.activeCount - a.stats.activeCount)
    }
    case "alphabetical": {
      const flat = flattenProjects(projects)
      return flat.sort((a, b) => a.name.localeCompare(b.name))
    }
    default:
      return projects
  }
}

function getSortedLabels(
  labels: TodoistLabelDoc[] | undefined,
  sortMode: LabelSort,
  labelCounts?: { labelCounts: { labelId: string; filteredTaskCount: number }[] }
): TodoistLabelDoc[] {
  if (!labels) return []

  switch (sortMode) {
    case "taskCount":
      return [...labels].sort((a, b) => {
        const countA =
          labelCounts?.labelCounts.find((c) => c.labelId === a.todoist_id)?.filteredTaskCount || 0
        const countB =
          labelCounts?.labelCounts.find((c) => c.labelId === b.todoist_id)?.filteredTaskCount || 0
        return countB - countA
      })
    case "alphabetical":
      return [...labels].sort((a, b) => a.name.localeCompare(b.name))
    default:
      return labels
  }
}

function buildProjectTree(projects: TodoistProjectsWithMetadata): ProjectTreeNode[] {
  const projectMap = new Map<string, ProjectTreeNode>()
  const rootProjects: ProjectTreeNode[] = []

  projects.forEach((project) => {
    projectMap.set(project.todoist_id, { ...project, children: [] })
  })

  projects.forEach((project) => {
    const projectWithChildren = projectMap.get(project.todoist_id)!
    if (project.parent_id && projectMap.has(project.parent_id)) {
      projectMap.get(project.parent_id)!.children.push(projectWithChildren)
    } else {
      rootProjects.push(projectWithChildren)
    }
  })

  const sortProjects = (nodes: ProjectTreeNode[]) => {
    nodes.sort((a, b) => a.child_order - b.child_order)
    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortProjects(node.children)
      }
    })
  }

  sortProjects(rootProjects)
  return rootProjects
}

function ProjectItem({
  project,
  currentViewKey,
  onViewChange,
  expandNested,
  level = 0,
  viewContext,
}: {
  project: ProjectTreeNode
  currentViewKey: ViewKey
  onViewChange: (view: ViewSelection) => void
  expandNested: boolean
  level?: number
  viewContext: ViewBuildContext
}) {
  const projectViewKey = `view:project:${project.todoist_id}` as ViewKey
  const projectFamilyKey = `view:project-family:${project.todoist_id}` as ViewKey
  const isActive = currentViewKey === projectViewKey || currentViewKey === projectFamilyKey
  const hasActiveItems = project.stats.activeCount > 0
  const hasChildren = project.children.length > 0

  const priority = usePriority(project.metadata?.priority)

  const handleProjectClick = () => {
    if (expandNested && hasChildren) {
      const viewKey = `view:project-family:${project.todoist_id}` as ViewKey
      onViewChange(resolveView(viewKey, viewContext))
    } else {
      onViewChange(resolveView(`view:project:${project.todoist_id}` as ViewKey, viewContext))
    }
  }

  return (
    <>
      <Button
        key={project._id}
        variant="ghost"
        className={cn("w-full justify-start h-8 px-3 text-sm", isActive && "bg-accent")}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={handleProjectClick}
      >
        <div
          className="w-2 h-2 rounded-full mr-3 flex-shrink-0"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />
        <span className="flex-1 text-left truncate">{project.name}</span>
        {priority?.showFlag && (
          <Flag className={cn("w-2.5 h-2.5 mr-2 flex-shrink-0", priority.colorClass)} fill="currentColor" />
        )}
        {hasActiveItems && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-6 text-center">
            {project.stats.activeCount}
          </span>
        )}
      </Button>

      {project.children.map((child) => (
        <ProjectItem
          key={child._id}
          project={child}
          currentViewKey={currentViewKey}
          onViewChange={onViewChange}
          expandNested={expandNested}
          level={level + 1}
          viewContext={viewContext}
        />
      ))}
    </>
  )
}

export function Sidebar({ currentViewKey, onViewChange }: SidebarProps) {
  const [expandNested, setExpandNested] = useState(false)
  const [priorityMode, setPriorityMode] = useState<"tasks" | "projects">("tasks")
  const [projectSort, setProjectSort] = useState<ProjectSort>("hierarchy")
  const [labelSort, setLabelSort] = useState<LabelSort>("taskCount")

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

  const viewItems: ViewNavItem[] = useMemo(
    () => [
      {
        key: "view:inbox",
        label: "Inbox",
        icon: Inbox,
        count: inboxProject?.stats.activeCount || null,
      },
      {
        key: "view:multi:priority-queue",
        label: "Priority Queue",
        icon: Filter,
        count: null,
      },
      {
        key: "view:today",
        label: "Today",
        icon: Calendar,
        count: null,
      },
      {
        key: "view:upcoming",
        label: "Upcoming",
        icon: Calendar,
        count: null,
      },
    ],
    [inboxProject?.stats.activeCount]
  )

  return (
    <div className="w-72 bg-muted/30 border-r h-full flex flex-col">
      <div className="p-4">
        <div className="space-y-1">
          {viewItems.map((item) => {
            const Icon = item.icon
            const isActive = currentViewKey === item.key

            const handleItemClick = () => {
              onViewChange(resolveView(item.key, viewContext))
            }

            return (
              <Button
                key={item.key}
                variant="ghost"
                className={cn("w-full justify-start h-9 px-3 text-sm", isActive && "bg-accent")}
                onClick={handleItemClick}
              >
                <Icon className="h-4 w-4 mr-3" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.count && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                    {item.count}
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Projects</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const sorts: ProjectSort[] = ["hierarchy", "priority", "taskCount", "alphabetical"]
                const currentIndex = sorts.indexOf(projectSort)
                const nextIndex = (currentIndex + 1) % sorts.length
                setProjectSort(sorts[nextIndex])
              }}
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
              title={`Sort: ${projectSort}`}
            >
              {projectSort === "hierarchy" && <Network className="h-3 w-3 text-muted-foreground" />}
              {projectSort === "priority" && <Flag className="h-3 w-3 text-muted-foreground" />}
              {projectSort === "taskCount" && <Hash className="h-3 w-3 text-muted-foreground" />}
              {projectSort === "alphabetical" && <ArrowDownAZ className="h-3 w-3 text-muted-foreground" />}
            </button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {projectSort === "hierarchy" && (
          <div className="mb-3 flex items-center gap-2 px-1">
            <input
              type="checkbox"
              id="expand-nested"
              checked={expandNested}
              onChange={(e) => setExpandNested(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            <label htmlFor="expand-nested" className="text-xs text-muted-foreground cursor-pointer">
              Load nested projects
            </label>
          </div>
        )}

        <div className="space-y-0.5 max-h-96 overflow-y-auto scrollbar-hide">
          {getSortedProjects(otherProjects, projectSort).map((project) => (
          <ProjectItem
            key={project._id}
            project={project}
            currentViewKey={currentViewKey}
            onViewChange={onViewChange}
            expandNested={expandNested}
            level={0}
            viewContext={viewContext}
          />
          ))}

          {(!otherProjects || otherProjects.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">No projects found</p>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Time</h3>
        </div>
        <div className="space-y-0.5">
          {[
            { id: "overdue", label: "Overdue", icon: AlertCircle, color: "text-red-500", filterKey: "overdue" },
            { id: "today", label: "Today", icon: Calendar, color: "text-blue-500", filterKey: "today" },
            { id: "upcoming", label: "Upcoming", icon: Calendar, color: "text-green-500", filterKey: "next7days" },
            { id: "no-date", label: "No Date", icon: Calendar, color: "text-gray-500", filterKey: "nodate" },
          ].map((timeFilter) => {
            const Icon = timeFilter.icon
            const viewKey = `view:time:${timeFilter.id}` as ViewKey
            const isActive = currentViewKey === viewKey
            const count =
              timeFilterCounts?.timeCounts.find((c) => c.filter === timeFilter.filterKey)?.filteredTaskCount || 0
            return (
              <Button
                key={timeFilter.id}
                variant="ghost"
                className={cn("w-full justify-start h-8 px-3 text-sm", isActive && "bg-accent")}
                onClick={() => onViewChange(resolveView(viewKey, viewContext))}
              >
                <Icon className={cn("h-4 w-4 mr-3", timeFilter.color)} />
                <span className="flex-1 text-left">{timeFilter.label}</span>
                {count > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-6 text-center">
                    {count}
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Priorities</h3>
        </div>

        <div className="mb-3 flex items-center gap-2 px-1">
          <input
            type="checkbox"
            id="priority-mode"
            checked={priorityMode === "projects"}
            onChange={(e) => setPriorityMode(e.target.checked ? "projects" : "tasks")}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          <label htmlFor="priority-mode" className="text-xs text-muted-foreground cursor-pointer">
            Show as projects
          </label>
        </div>

        <div className="space-y-0.5">
          {[
            { id: "p1", label: "Priority 1", icon: Flag, color: "text-red-500", priorityLevel: 4 },
            { id: "p2", label: "Priority 2", icon: Flag, color: "text-orange-500", priorityLevel: 3 },
            { id: "p3", label: "Priority 3", icon: Flag, color: "text-blue-500", priorityLevel: 2 },
            { id: "p4", label: "Priority 4", icon: Flag, color: "text-gray-500", priorityLevel: 1 },
          ].map((priority) => {
            const Icon = priority.icon
            const viewKey = (
              priorityMode === "projects"
                ? `view:priority-projects:${priority.id}`
                : `view:priority:${priority.id}`
            ) as ViewKey
            const isActive = currentViewKey === viewKey
            const count =
              priorityFilterCounts?.priorityCounts.find((c) => c.priority === priority.priorityLevel)?.filteredTaskCount || 0

            const handlePriorityClick = () => {
              onViewChange(resolveView(viewKey, viewContext))
            }

            return (
              <Button
                key={priority.id}
                variant="ghost"
                className={cn("w-full justify-start h-8 px-3 text-sm", isActive && "bg-accent")}
                onClick={handlePriorityClick}
              >
                <Icon className={cn("h-4 w-4 mr-3", priority.color)} fill="currentColor" />
                <span className="flex-1 text-left">{priority.label}</span>
                {count > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-6 text-center">
                    {count}
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Labels</h3>
          <button
            onClick={() => {
              const sorts: LabelSort[] = ["taskCount", "alphabetical"]
              const currentIndex = sorts.indexOf(labelSort)
              const nextIndex = (currentIndex + 1) % sorts.length
              setLabelSort(sorts[nextIndex])
            }}
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted transition-colors"
            title={`Sort: ${labelSort}`}
          >
            {labelSort === "taskCount" && <Hash className="h-3 w-3 text-muted-foreground" />}
            {labelSort === "alphabetical" && <ArrowDownAZ className="h-3 w-3 text-muted-foreground" />}
          </button>
        </div>
        <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-hide">
          {getSortedLabels(labels, labelSort, labelFilterCounts).map((label) => {
            const viewKey = `view:label:${label.name}` as ViewKey
            const isActive = currentViewKey === viewKey
            const count =
              labelFilterCounts?.labelCounts.find((c) => c.labelId === label.todoist_id)?.filteredTaskCount || 0
            return (
              <Button
                key={label._id}
                variant="ghost"
                className={cn("w-full justify-start h-8 px-3 text-sm", isActive && "bg-accent")}
                onClick={() => onViewChange(resolveView(viewKey, viewContext))}
              >
                <Tag className="h-4 w-4 mr-3" style={{ color: getProjectColor(label.color) }} />
                <span className="flex-1 text-left">@{label.name}</span>
                {count > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-6 text-center">
                    {count}
                  </span>
                )}
              </Button>
            )
          })}
          {(!labels || labels.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">No labels found</p>
          )}
        </div>
      </div>
    </div>
  )
}
