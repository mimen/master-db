import { Flag } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/convex/_generated/api"
import { useTodoistAction } from "@/hooks/useTodoistAction"
import { PRIORITY_MAP } from "@/lib/priorities"
import { cn } from "@/lib/utils"

interface PrioritySelectorProps {
  value?: number // 1-4, where 1 is default (no priority)
  todoistId?: string // Todoist ID of task to update
  onChange?: (priority: number) => void
  placeholder?: string
  disabled?: boolean
  size?: "default" | "sm"
}

// Use canonical priority mapping
const PRIORITIES = Object.values(PRIORITY_MAP).map((p) => ({
  value: p.apiPriority,
  label: p.displayName,
  color: p.color ? `text-${p.color}-500` : "text-gray-500",
  display: p.uiPriority,
}))

export function PrioritySelector({
  value = 1,
  todoistId,
  onChange,
  placeholder = "Set priority",
  disabled = false,
  size = "default"
}: PrioritySelectorProps) {
  const updateTask = useTodoistAction(api.todoist.publicActions.updateTask, {
    loadingMessage: "Updating priority...",
    successMessage: "Priority updated!",
    errorMessage: "Failed to update priority"
  })

  const handleChange = (priorityStr: string) => {
    const priority = parseInt(priorityStr)

    // Call onChange callback if provided
    onChange?.(priority)

    // Update task if todoistId is provided (fire and forget)
    if (todoistId) {
      updateTask({
        todoistId,
        priority
      })
    }
  }

  const selectedPriority = PRIORITIES.find(p => p.value === value)

  return (
    <Select
      value={value.toString()}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectTrigger className={cn(
        "w-[140px]",
        size === "sm" && "h-8 text-xs"
      )}>
        <SelectValue placeholder={placeholder}>
          {selectedPriority && (
            <div className="flex items-center gap-2">
              <Flag
                className={cn(
                  "h-3.5 w-3.5",
                  selectedPriority.color
                )}
                fill={value > 1 ? "currentColor" : "none"}
              />
              <span>{selectedPriority.display}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((priority) => (
          <SelectItem
            key={priority.value}
            value={priority.value.toString()}
          >
            <div className="flex items-center gap-2">
              <Flag
                className={cn(
                  "h-3.5 w-3.5",
                  priority.color
                )}
                fill={priority.value > 1 ? "currentColor" : "none"}
              />
              <span>{priority.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}