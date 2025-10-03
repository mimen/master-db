import { useQuery } from "convex/react"
import { Inbox, Calendar, Filter, Settings, Plus, Flag, Clock, Tag, AlertCircle } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"
import type {
  TodoistLabelDoc,
  TodoistProjects,
  TodoistProjectsWithMetadata,
  TodoistProjectWithMetadata,
} from "@/types/convex/todoist"
import type { ViewConfig } from "@/types/views"

interface SidebarProps {
  currentView: string
  onViewChange: (view: string) => void
  onMultiViewChange?: (views: ViewConfig[]) => void
}

type ProjectTreeNode = TodoistProjectWithMetadata & { children: ProjectTreeNode[] }

// Helper function to build hierarchical project tree
function buildProjectTree(projects: TodoistProjectsWithMetadata): ProjectTreeNode[] {
  const projectMap = new Map<string, ProjectTreeNode>()
  const rootProjects: ProjectTreeNode[] = []

  // First pass: create map and add children array
  projects.forEach((project: TodoistProjectWithMetadata) => {
    projectMap.set(project.todoist_id, { ...project, children: [] })
  })

  // Second pass: build hierarchy
  projects.forEach((project: TodoistProjectWithMetadata) => {
    const projectWithChildren = projectMap.get(project.todoist_id)!
    if (project.parent_id && projectMap.has(project.parent_id)) {
      // Add to parent's children
      projectMap.get(project.parent_id)!.children.push(projectWithChildren)
    } else {
      // Root level project
      rootProjects.push(projectWithChildren)
    }
  })

  // Sort at each level by child_order
  const sortProjects = (projects: ProjectTreeNode[]) => {
    projects.sort((a, b) => a.child_order - b.child_order)
    projects.forEach(project => {
      if (project.children.length > 0) {
        sortProjects(project.children)
      }
    })
  }

  sortProjects(rootProjects)
  return rootProjects
}

// Component to render a project with its children
function ProjectItem({
  project,
  currentView,
  onViewChange,
  onMultiViewChange,
  expandNested,
  level = 0
}: {
  project: ProjectTreeNode
  currentView: string
  onViewChange: (view: string) => void
  onMultiViewChange?: (views: ViewConfig[]) => void
  expandNested: boolean
  level?: number
}) {
  const isActive = currentView === `project:${project.todoist_id}`
  const hasActiveItems = project.stats.activeCount > 0
  const hasChildren = project.children.length > 0

  // Use the canonical priority utilities
  const priority = usePriority(project.metadata?.priority)

  const handleProjectClick = () => {
    if (expandNested && hasChildren && onMultiViewChange) {
      const views: ViewConfig[] = [
        {
          id: `project-${project.todoist_id}`,
          type: "project",
          value: `project:${project.todoist_id}`,
          title: project.name,
          collapsible: true,
          expanded: true
        },
        ...project.children.map((child: ProjectTreeNode) => ({
          id: `project-${child.todoist_id}`,
          type: "project" as const,
          value: `project:${child.todoist_id}`,
          title: child.name,
          collapsible: true,
          expanded: true
        }))
      ]
      onMultiViewChange(views)
    } else {
      onViewChange(`project:${project.todoist_id}`)
    }
  }

  return (
    <>
      <Button
        key={project._id}
        variant="ghost"
        className={cn(
          "w-full justify-start h-8 px-3 text-sm", // Increased height and padding
          isActive && "bg-accent"
        )}
        style={{ paddingLeft: `${12 + level * 16}px` }} // Increased base padding
        onClick={handleProjectClick}
      >
        {/* Color dot */}
        <div
          className="w-2 h-2 rounded-full mr-3 flex-shrink-0"
          style={{ backgroundColor: getProjectColor(project.color) }}
        />

        {/* Project name */}
        <span className="flex-1 text-left truncate">{project.name}</span>

        {/* Priority indicator */}
        {priority?.showFlag && (
          <Flag className={cn("w-2.5 h-2.5 mr-2 flex-shrink-0", priority.colorClass)} fill="currentColor" />
        )}

        {/* Task count */}
        {hasActiveItems && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 min-w-6 text-center">
            {project.stats.activeCount}
          </span>
        )}
      </Button>

      {/* Render children */}
      {project.children.map((child: ProjectTreeNode) => (
        <ProjectItem
          key={child._id}
          project={child}
          currentView={currentView}
          onViewChange={onViewChange}
          onMultiViewChange={onMultiViewChange}
          expandNested={expandNested}
          level={level + 1}
        />
      ))}
    </>
  )
}

export function Sidebar({ currentView, onViewChange, onMultiViewChange }: SidebarProps) {
  const [expandNested, setExpandNested] = useState(false)

  const enhancedProjects = useQuery(api.todoist.publicQueries.getProjectsWithMetadata, {}) as
    | TodoistProjectsWithMetadata
    | undefined

  const basicProjects = useQuery(api.todoist.publicQueries.getProjects) as
    | TodoistProjects
    | undefined

  const labels = useQuery(api.todoist.publicQueries.getLabels) as
    | TodoistLabelDoc[]
    | undefined

  const projectsData: TodoistProjectsWithMetadata | undefined = (enhancedProjects && enhancedProjects.length > 0)
    ? enhancedProjects
    : basicProjects?.map((project: TodoistProjectWithMetadata) => ({
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

  // Build hierarchical structure
  const projectTree = projectsData ? buildProjectTree(projectsData) : []

  // Find inbox project
  const inboxProject = projectsData?.find((project: TodoistProjectWithMetadata) =>
    project.name === "Inbox" && !project.parent_id
  )

  // Get non-inbox projects
  const otherProjects = projectTree.filter(
    (project) => project.todoist_id !== inboxProject?.todoist_id
  )

  const viewItems = [
    {
      id: "inbox",
      label: "Inbox",
      icon: Inbox,
      count: inboxProject?.stats.activeCount || null,
    },
    {
      id: "today",
      label: "Today",
      icon: Calendar,
      count: null,
    },
    {
      id: "upcoming",
      label: "Upcoming",
      icon: Calendar,
      count: null,
    },
  ]

  return (
    <div className="w-72 bg-muted/30 border-r h-full flex flex-col"> {/* Increased width */}
      {/* Views Section */}
      <div className="p-4">
        <div className="space-y-1">
          {viewItems.map((item) => {
            const Icon = item.icon
            const isActive = currentView === item.id

            return (
              <Button
                key={item.id}
                variant="ghost"
                className={cn(
                  "w-full justify-start h-9 px-3 text-sm", // Increased height and padding
                  isActive && "bg-accent"
                )}
                onClick={() => onViewChange(item.id)}
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

      {/* Projects Section */}
      <div className="flex-1 px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Projects</h3>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
            <Plus className="h-3 w-3" />
          </Button>
        </div>

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

        <div className="space-y-0.5 max-h-96 overflow-y-auto">
          {otherProjects?.map((project: ProjectTreeNode) => (
            <ProjectItem
              key={project._id}
              project={project}
              currentView={currentView}
              onViewChange={onViewChange}
              onMultiViewChange={onMultiViewChange}
              expandNested={expandNested}
              level={0}
            />
          ))}

          {(!otherProjects || otherProjects.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No projects found
            </p>
          )}
        </div>
      </div>

      {/* Time Filters Section */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Time</h3>
        </div>
        <div className="space-y-0.5">
          {[
            { id: "overdue", label: "Overdue", icon: AlertCircle, color: "text-red-500" },
            { id: "today", label: "Today", icon: Calendar, color: "text-blue-500" },
            { id: "upcoming", label: "Upcoming", icon: Clock, color: "text-green-500" },
            { id: "no-date", label: "No Date", icon: Calendar, color: "text-gray-500" },
          ].map((timeFilter) => {
            const Icon = timeFilter.icon
            const isActive = currentView === `time:${timeFilter.id}`
            return (
              <Button
                key={timeFilter.id}
                variant="ghost"
                className={cn(
                  "w-full justify-start h-8 px-3 text-sm",
                  isActive && "bg-accent"
                )}
                onClick={() => onViewChange(`time:${timeFilter.id}`)}
              >
                <Icon className={cn("h-4 w-4 mr-3", timeFilter.color)} />
                <span className="flex-1 text-left">{timeFilter.label}</span>
              </Button>
            )
          })}
        </div>
      </div>

      {/* Priorities Section */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Priorities</h3>
        </div>
        <div className="space-y-0.5">
          {[
            { id: "p1", label: "Priority 1", icon: Flag, color: "text-red-500" },
            { id: "p2", label: "Priority 2", icon: Flag, color: "text-orange-500" },
            { id: "p3", label: "Priority 3", icon: Flag, color: "text-blue-500" },
            { id: "p4", label: "Priority 4", icon: Flag, color: "text-gray-500" },
          ].map((priority) => {
            const Icon = priority.icon
            const isActive = currentView === `priority:${priority.id}`
            return (
              <Button
                key={priority.id}
                variant="ghost"
                className={cn(
                  "w-full justify-start h-8 px-3 text-sm",
                  isActive && "bg-accent"
                )}
                onClick={() => onViewChange(`priority:${priority.id}`)}
              >
                <Icon className={cn("h-4 w-4 mr-3", priority.color)} fill="currentColor" />
                <span className="flex-1 text-left">{priority.label}</span>
              </Button>
            )
          })}
        </div>
      </div>

      {/* Labels Section */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Labels</h3>
        </div>
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {labels?.slice(0, 10).map((label: TodoistLabelDoc) => {
            const isActive = currentView === `label:${label.name}`
            return (
              <Button
                key={label._id}
                variant="ghost"
                className={cn(
                  "w-full justify-start h-8 px-3 text-sm",
                  isActive && "bg-accent"
                )}
                onClick={() => onViewChange(`label:${label.name}`)}
              >
                <Tag className="h-4 w-4 mr-3 text-muted-foreground" />
                <span className="flex-1 text-left">@{label.name}</span>
              </Button>
            )
          })}
          {(!labels || labels.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No labels found
            </p>
          )}
        </div>
      </div>

      {/* Filters & Settings */}
      <div className="border-t p-4 space-y-1">
        <Button
          variant="ghost"
          className="w-full justify-start h-9 px-3 text-sm" // Match main navigation style
          onClick={() => onViewChange("filters")}
        >
          <Filter className="h-4 w-4 mr-3" />
          <span className="flex-1 text-left">Filters & Labels</span>
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start h-9 px-3 text-sm" // Match main navigation style
          onClick={() => onViewChange("settings")}
        >
          <Settings className="h-4 w-4 mr-3" />
          <span className="flex-1 text-left">Settings</span>
        </Button>
      </div>
    </div>
  )
}
