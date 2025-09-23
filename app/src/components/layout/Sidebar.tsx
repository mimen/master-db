import { useQuery } from "convex/react"
import { Inbox, Calendar, Filter, Settings, Plus, Flag } from "lucide-react"

import { Button } from "@/components/ui/button"
import { api } from "@/convex/_generated/api"
import { getProjectColor } from "@/lib/colors"
import { usePriority } from "@/lib/priorities"
import { cn } from "@/lib/utils"

interface ProjectWithMetadata {
  _id: string
  todoist_id: string
  name: string
  color: string
  parent_id?: string
  is_deleted: number
  is_archived: number
  child_order: number
  metadata: {
    priority: number
    scheduledDate?: string
    description?: string
    sourceTaskId?: string
    lastUpdated?: string
  } | null
  stats: {
    itemCount: number
    activeCount: number
    completedCount: number
  }
  computed: {
    isScheduled: boolean
    isHighPriority: boolean
    completionRate: number | null
    hasActiveItems: boolean
  }
}

interface SidebarProps {
  currentView: string
  onViewChange: (view: string) => void
}

type ProjectTreeNode = ProjectWithMetadata & { children: ProjectTreeNode[] }

// Helper function to build hierarchical project tree
function buildProjectTree(projects: ProjectWithMetadata[]): ProjectTreeNode[] {
  const projectMap = new Map<string, ProjectTreeNode>()
  const rootProjects: ProjectTreeNode[] = []

  // First pass: create map and add children array
  projects.forEach(project => {
    projectMap.set(project.todoist_id, { ...project, children: [] })
  })

  // Second pass: build hierarchy
  projects.forEach(project => {
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
  level = 0
}: {
  project: ProjectTreeNode
  currentView: string
  onViewChange: (view: string) => void
  level?: number
}) {
  const isActive = currentView === `project:${project.todoist_id}`
  const hasActiveItems = project.stats.activeCount > 0

  // Use the canonical priority utilities
  const priority = usePriority(project.metadata?.priority)

  return (
    <>
      <Button
        key={project._id}
        variant="ghost"
        className={cn(
          "w-full justify-start h-8 px-3 text-sm group", // Increased height and padding
          isActive && "bg-accent"
        )}
        style={{ paddingLeft: `${12 + level * 16}px` }} // Increased base padding
        onClick={() => onViewChange(`project:${project.todoist_id}`)}
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
      {project.children.map(child => (
        <ProjectItem
          key={child._id}
          project={child}
          currentView={currentView}
          onViewChange={onViewChange}
          level={level + 1}
        />
      ))}
    </>
  )
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  // Try to use the enhanced projects with metadata query
  const enhancedProjects = useQuery(api.todoist.publicQueries.getProjectsWithMetadata, {})

  // Fallback to basic projects if enhanced query fails
  const basicProjects = useQuery(api.todoist.publicQueries.getProjects)

  // Use enhanced projects if available and not empty, otherwise transform basic projects
  const projectsData = (enhancedProjects && enhancedProjects.length > 0)
    ? enhancedProjects
    : basicProjects?.map((p: { todoist_id: string; name: string; parent_id?: string }) => ({
    ...p,
    metadata: {
      priority: 4, // Default priority when no metadata available
      scheduledDate: null,
      description: null,
      sourceTaskId: null,
      lastUpdated: null
    },
    stats: {
      itemCount: 0,
      activeCount: 0,
      completedCount: 0
    },
    computed: {
      isScheduled: false,
      isHighPriority: false,
      completionRate: null,
      hasActiveItems: false
    }
  }))

  // Build hierarchical structure
  const projectTree = projectsData ? buildProjectTree(projectsData) : []

  // Find inbox project
  const inboxProject = projectsData?.find((p: ProjectWithMetadata) =>
    p.name === "Inbox" && !p.parent_id
  )

  // Get non-inbox projects
  const otherProjects = projectTree.filter((p: ProjectTreeNode) =>
    p.todoist_id !== inboxProject?.todoist_id
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
        <div className="flex items-center justify-between mb-3"> {/* Increased margin */}
          <h3 className="text-sm font-medium text-muted-foreground">Projects</h3>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        <div className="space-y-0.5 max-h-96 overflow-y-auto"> {/* Reduced spacing between items */}
          {otherProjects?.map((project: ProjectTreeNode) => (
            <ProjectItem
              key={project._id}
              project={project}
              currentView={currentView}
              onViewChange={onViewChange}
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