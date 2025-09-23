import { useState, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { Flag, Calendar, Tag, User, Check, Edit2 } from "lucide-react"

import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { ProjectSelector, LabelSelector, PrioritySelector } from "@/components/dropdowns"
import { cn } from "@/lib/utils"

interface Task {
  _id: string
  todoist_id: string
  content: string
  description?: string
  project_id?: string
  priority: number
  labels: string[]
  due?: {
    date: string
    datetime?: string
    is_recurring?: boolean
  }
  checked: number
  assignee_id?: string
}

interface Project {
  _id: string
  todoist_id: string
  name: string
  color: string
  parent_id?: string
  is_deleted: number
  is_archived: number
}

interface TaskListViewProps {
  currentView: string
}

export function TaskListView({ currentView }: TaskListViewProps) {
  // Get projects for inbox and project views
  const projects = useQuery(api.todoist.queries.getProjects.getProjects)
  
  // Use different queries based on the current view for better performance
  const inboxTasks = useQuery(
    api.todoist.queries.getActiveItems.getActiveItems,
    currentView === "inbox" ? {} : "skip"
  )
  const todayTasks = useQuery(
    api.todoist.queries.getDueTodayItems.getDueTodayItems,
    currentView === "today" ? {} : "skip"
  )
  const upcomingTasks = useQuery(
    api.todoist.queries.getDueNext7DaysItems.getDueNext7DaysItems,
    currentView === "upcoming" ? {} : "skip"
  )
  const projectTasks = useQuery(
    api.todoist.queries.getActiveItems.getActiveItems,
    currentView.startsWith("project:") ? {} : "skip"
  )

  // Get the appropriate tasks based on current view
  const filteredTasks = useMemo(() => {
    switch (currentView) {
      case "inbox": {
        if (!inboxTasks || !projects) return []
        const inboxProject = projects.find((p: Project) =>
          p.name === "Inbox" && !p.parent_id && p.is_deleted === 0 && p.is_archived === 0
        )
        return inboxTasks.filter((task: Task) =>
          task.project_id === inboxProject?.todoist_id
        )
      }
      case "today": {
        return todayTasks || []
      }
      case "upcoming": {
        return upcomingTasks || []
      }
      default: {
        // Handle project views (format: "project:PROJECT_ID")
        if (currentView.startsWith("project:")) {
          if (!projectTasks) return []
          const projectId = currentView.replace("project:", "")
          return projectTasks.filter((task: Task) => task.project_id === projectId)
        }
        return []
      }
    }
  }, [currentView, inboxTasks, todayTasks, upcomingTasks, projectTasks, projects])

  // Get view title and description
  const getViewInfo = () => {
    switch (currentView) {
      case "inbox":
        return { title: "Inbox", description: `${filteredTasks.length} tasks to process` }
      case "today":
        return { title: "Today", description: `${filteredTasks.length} tasks due today` }
      case "upcoming":
        return { title: "Upcoming", description: `${filteredTasks.length} tasks due this week` }
      default: {
        if (currentView.startsWith("project:")) {
          const projectId = currentView.replace("project:", "")
          const project = projects?.find((p: Project) => p.todoist_id === projectId)
          return {
            title: project?.name || "Project",
            description: `${filteredTasks.length} tasks in this project`
          }
        }
        return { title: "Tasks", description: `${filteredTasks.length} tasks` }
      }
    }
  }

  const { title, description } = getViewInfo()
  
  // Check if we're still loading based on current view
  const isLoading = useMemo(() => {
    switch (currentView) {
      case "inbox":
        return inboxTasks === undefined || !projects
      case "today":
        return todayTasks === undefined
      case "upcoming":
        return upcomingTasks === undefined
      default:
        if (currentView.startsWith("project:")) {
          return projectTasks === undefined || !projects
        }
        return false
    }
  }, [currentView, inboxTasks, todayTasks, upcomingTasks, projectTasks, projects])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading tasks...</p>
      </div>
    )
  }

  const getEmptyStateMessage = () => {
    switch (currentView) {
      case "inbox":
        return {
          emoji: "🎉",
          title: "Inbox Zero!",
          description: "All tasks have been processed and moved to projects"
        }
      case "today":
        return {
          emoji: "✅",
          title: "All caught up!",
          description: "No tasks due today"
        }
      case "upcoming":
        return {
          emoji: "📅",
          title: "Nothing upcoming!",
          description: "No tasks due in the next 7 days"
        }
      default:
        return {
          emoji: "📝",
          title: "No tasks here!",
          description: "This view is empty"
        }
    }
  }

  const emptyState = getEmptyStateMessage()

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
      </div>

      {filteredTasks.length > 0 ? (
        <div className="space-y-1">
          {filteredTasks.map((task: Task) => (
            <TaskRow key={task._id} task={task} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="text-6xl mb-4">{emptyState.emoji}</div>
          <p className="text-xl font-semibold mb-2">{emptyState.title}</p>
          <p className="text-muted-foreground">{emptyState.description}</p>
        </div>
      )}
    </div>
  )
}

function TaskRow({ task }: { task: Task }) {
  const [isEditing, setIsEditing] = useState(false)
  const completeTask = useMutation(api.todoist.actions.completeTask.completeTask)

  const handleComplete = async () => {
    try {
      await completeTask({ todoistId: task.todoist_id })
    } catch (error) {
      console.error("Failed to complete task:", error)
    }
  }

  const formatDueDate = (due: Task["due"]) => {
    if (!due) return { text: null, isOverdue: false }

    const date = new Date(due.date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    date.setHours(0, 0, 0, 0)

    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const isOverdue = date < today
    let text = ""

    if (date.toDateString() === today.toDateString()) {
      text = "Today"
    } else if (date.toDateString() === tomorrow.toDateString()) {
      text = "Tomorrow"
    } else if (isOverdue) {
      const daysOverdue = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      text = daysOverdue === 1 ? "Yesterday" : `${daysOverdue} days overdue`
    } else {
      text = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined
      })
    }

    return { text, isOverdue }
  }
  
  return (
    <div className="group flex items-center gap-3 p-3 hover:bg-muted/50 rounded-lg transition-colors">
      {/* Checkbox */}
      <button
        onClick={handleComplete}
        className={cn(
          "w-5 h-5 rounded-full border-2 transition-colors flex-shrink-0 flex items-center justify-center",
          "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        )}
      >
        {task.checked === 1 && (
          <Check className="w-3 h-3 text-green-600" />
        )}
      </button>
      
      {/* Task content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-normal">{task.content}</p>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
        )}
        
        {/* Task metadata */}
        <div className="flex items-center gap-3 mt-2">
          {/* Priority - only show for P2, P3, P4 */}
          {task.priority > 1 && task.priority <= 4 && (
            <div className="flex items-center gap-1">
              <Flag
                className={cn("h-3.5 w-3.5", {
                  "text-blue-500": task.priority === 2,
                  "text-orange-500": task.priority === 3,
                  "text-red-500": task.priority === 4,
                })}
                fill="currentColor"
              />
              <span className="text-xs text-muted-foreground">P{task.priority}</span>
            </div>
          )}

          {/* Due date */}
          {task.due && (() => {
            const { text, isOverdue } = formatDueDate(task.due)
            return text ? (
              <div className={cn(
                "flex items-center gap-1 text-xs",
                isOverdue ? "text-red-500" : "text-muted-foreground"
              )}>
                <Calendar className="h-3 w-3" />
                <span>{text}</span>
              </div>
            ) : null
          })()}

          {/* Labels */}
          {task.labels.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {task.labels.map((label) => (
                <span
                  key={label}
                  className="text-xs px-1.5 py-0.5 bg-muted rounded-full"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          {/* Assignee */}
          {task.assignee_id && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Assigned</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Actions (visible on hover) */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
        {isEditing ? (
          <>
            <ProjectSelector
              value={task.project_id}
              taskId={task.todoist_id}
              placeholder="Move to..."
            />
            <LabelSelector
              value={task.labels}
              taskId={task.todoist_id}
              placeholder="Labels"
            />
            <PrioritySelector
              value={task.priority}
              taskId={task.todoist_id}
              placeholder="Priority"
              size="sm"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(false)}
            >
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <ProjectSelector
              value={task.project_id}
              taskId={task.todoist_id}
              placeholder="Move"
              disabled={false}
            />
          </>
        )}
      </div>
    </div>
  )
}