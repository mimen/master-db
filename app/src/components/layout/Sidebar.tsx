import { useQuery } from "convex/react"
import { Inbox, Calendar, Filter, Settings, Plus } from "lucide-react"

import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { getProjectColor } from "@/lib/colors"
import { cn } from "@/lib/utils"

interface Project {
  _id: string
  todoist_id: string
  name: string
  color: string
  parent_id?: string
  is_deleted: number
  is_archived: number
  child_order: number
}

interface SidebarProps {
  currentView: string
  onViewChange: (view: string) => void
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const projects = useQuery(api.todoist.queries.getProjects.getProjects)

  // Filter to active projects and sort by child_order
  const activeProjects = projects
    ?.filter((p: Project) => p.is_deleted === 0 && p.is_archived === 0)
    ?.sort((a: Project, b: Project) => a.child_order - b.child_order)

  // Find inbox project
  const inboxProject = activeProjects?.find((p: Project) =>
    p.name === "Inbox" && !p.parent_id
  )

  // Get other projects (exclude inbox)
  const otherProjects = activeProjects?.filter((p: Project) =>
    p.todoist_id !== inboxProject?.todoist_id
  )

  const viewItems = [
    {
      id: "inbox",
      label: "Inbox",
      icon: Inbox,
      count: null, // We could add task counts later
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
    <div className="w-64 bg-muted/30 border-r h-full flex flex-col">
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
                  "w-full justify-start h-8 px-2",
                  isActive && "bg-accent"
                )}
                onClick={() => onViewChange(item.id)}
              >
                <Icon className="h-4 w-4 mr-3" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.count && (
                  <span className="text-xs text-muted-foreground">
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
        
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {otherProjects?.map((project: Project) => {
            const isActive = currentView === `project:${project.todoist_id}`
            const isChild = !!project.parent_id

            return (
              <Button
                key={project._id}
                variant="ghost"
                className={cn(
                  "w-full justify-start h-7 px-2 text-sm",
                  isChild && "pl-6",
                  isActive && "bg-accent"
                )}
                onClick={() => onViewChange(`project:${project.todoist_id}`)}
              >
                <div
                  className="w-2 h-2 rounded-full mr-3 flex-shrink-0"
                  style={{ backgroundColor: getProjectColor(project.color) }}
                />
                <span className="flex-1 text-left truncate">{project.name}</span>
              </Button>
            )
          })}

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
          className="w-full justify-start h-8 px-2"
          onClick={() => onViewChange("filters")}
        >
          <Filter className="h-4 w-4 mr-3" />
          <span className="flex-1 text-left">Filters & Labels</span>
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start h-8 px-2"
          onClick={() => onViewChange("settings")}
        >
          <Settings className="h-4 w-4 mr-3" />
          <span className="flex-1 text-left">Settings</span>
        </Button>
      </div>
    </div>
  )
}