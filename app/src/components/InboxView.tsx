import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Flag, Calendar, Tag, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { getPriorityColor, getProjectColor } from "@/lib/colors"

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

export function InboxView() {
  // Get all tasks and projects
  const allTasks = useQuery(api.todoist.queries.getActiveItems.getActiveItems)
  const projects = useQuery(api.todoist.queries.getProjects.getProjects)
  
  // Find inbox project - typically named "Inbox" and has no parent
  const inboxProject = projects?.find((p: Project) => 
    p.name === "Inbox" && !p.parent_id && p.is_deleted === 0 && p.is_archived === 0
  )
  
  // Filter tasks that belong to inbox
  const inboxTasks = allTasks?.filter((task: Task) => 
    task.project_id === inboxProject?.todoist_id
  )
  
  if (!allTasks || !projects) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading inbox...</p>
      </div>
    )
  }
  
  if (!inboxProject) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Inbox project not found</p>
      </div>
    )
  }
  
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="text-muted-foreground mt-1">
          {inboxTasks?.length || 0} tasks to process
        </p>
      </div>
      
      {inboxTasks && inboxTasks.length > 0 ? (
        <div className="space-y-1">
          {inboxTasks.map((task) => (
            <TaskRow key={task._id} task={task} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <p className="text-xl font-semibold mb-2">Inbox Zero!</p>
          <p className="text-muted-foreground">
            All tasks have been processed and moved to projects
          </p>
        </div>
      )}
    </div>
  )
}

function TaskRow({ task }: { task: Task }) {
  const handleComplete = async () => {
    // TODO: Implement task completion
    console.log("Complete task:", task.todoist_id)
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
        className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-gray-400 transition-colors flex-shrink-0"
      />
      
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
        <Button size="sm" variant="ghost">Edit</Button>
        <Button size="sm" variant="ghost">Move</Button>
      </div>
    </div>
  )
}