import { useAction, useQuery } from "convex/react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/convex/_generated/api"
import { getProjectColor } from "@/lib/colors"
import type { TodoistProject } from "@/types/convex/todoist"

interface ProjectSelectorProps {
  value?: string // todoist_id of selected project
  todoistId?: string // Todoist ID of task to update
  onChange?: (projectId: string) => void
  placeholder?: string
  disabled?: boolean
}

export function ProjectSelector({
  value,
  todoistId,
  onChange,
  placeholder = "Select project",
  disabled = false
}: ProjectSelectorProps) {
  const projects: TodoistProject[] | undefined = useQuery(api.todoist.queries.getProjects.getProjects)
  const moveTask = useAction(api.todoist.publicActions.moveTask)

  // Filter to active projects and sort by child_order
  const activeProjects = projects
    ?.filter((project) => !project.is_deleted && !project.is_archived)
    ?.sort((a, b) => a.child_order - b.child_order)

  const handleChange = async (projectId: string) => {
    // Call onChange callback if provided
    onChange?.(projectId)

    // Update task if todoistId is provided
    if (todoistId) {
      try {
        await moveTask({
          todoistId,
          projectId
        })
      } catch (error) {
        console.error("Failed to update task project:", error)
      }
    }
  }

  const selectedProject = activeProjects?.find((project) => project.todoist_id === value)

  return (
    <Select
      value={value}
      onValueChange={handleChange}
      disabled={disabled || !activeProjects}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder={placeholder}>
          {selectedProject && (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: getProjectColor(selectedProject.color) }}
              />
              <span className="truncate">{selectedProject.name}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {activeProjects?.map((project) => {
          // Indent child projects
          const isChild = !!project.parent_id
          const indent = isChild ? "pl-6" : ""

          return (
            <SelectItem
              key={project._id}
              value={project.todoist_id}
              className={indent}
            >
              <div className="flex items-center gap-2">
                {isChild ? (
                  <div className="w-3" /> // Spacer for child projects
                ) : (
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getProjectColor(project.color) }}
                  />
                )}
                <span>{project.name}</span>
              </div>
            </SelectItem>
          )
        })}
        {(!activeProjects || activeProjects.length === 0) && (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No projects available
          </div>
        )}
      </SelectContent>
    </Select>
  )
}
