import { useMutation } from "convex/react"
import { Flag } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"

interface PrioritySelectorProps {
  value?: number // 1-4, where 1 is default (no priority)
  taskId?: string // If provided, will update the task when selection changes
  onChange?: (priority: number) => void
  placeholder?: string
  disabled?: boolean
  size?: "default" | "sm"
}

const PRIORITIES = [
  { value: 1, label: "Priority 4", color: "text-gray-500", display: "P4" },
  { value: 2, label: "Priority 3", color: "text-blue-500", display: "P3" },
  { value: 3, label: "Priority 2", color: "text-orange-500", display: "P2" },
  { value: 4, label: "Priority 1", color: "text-red-500", display: "P1" },
]

export function PrioritySelector({
  value = 1,
  taskId,
  onChange,
  placeholder = "Set priority",
  disabled = false,
  size = "default"
}: PrioritySelectorProps) {
  const updateTask = useMutation(api.todoist.actions.updateTask.updateTask)

  const handleChange = async (priorityStr: string) => {
    const priority = parseInt(priorityStr)

    // Call onChange callback if provided
    onChange?.(priority)

    // Update task if taskId is provided
    if (taskId) {
      try {
        await updateTask({
          taskId,
          updates: { priority }
        })
      } catch (error) {
        console.error("Failed to update task priority:", error)
      }
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