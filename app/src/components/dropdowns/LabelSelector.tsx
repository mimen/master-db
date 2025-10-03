import { useAction, useQuery } from "convex/react"
import { Check, Tag, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { api } from "@/convex/_generated/api"
import { getProjectColor } from "@/lib/colors"
import { cn } from "@/lib/utils"
import type { TodoistLabelDoc } from "@/types/convex/todoist"

interface LabelSelectorProps {
  value?: string[] // Array of label names (not IDs)
  todoistId?: string // Todoist ID of task to update
  onChange?: (labels: string[]) => void
  placeholder?: string
  disabled?: boolean
}

export function LabelSelector({
  value = [],
  todoistId,
  onChange,
  placeholder = "Add labels",
  disabled = false
}: LabelSelectorProps) {
  const [open, setOpen] = useState(false)
  const labels: TodoistLabelDoc[] | undefined = useQuery(api.todoist.queries.getLabels.getLabels)
  const updateTask = useAction(api.todoist.publicActions.updateTask)

  // Filter to active labels and sort by order
  const activeLabels = labels
    ?.filter((label) => !label.is_deleted)
    ?.sort((a, b) => a.order - b.order)

  const handleToggleLabel = async (labelName: string) => {
    const newLabels = value.includes(labelName)
      ? value.filter(l => l !== labelName)
      : [...value, labelName]

    // Call onChange callback if provided
    onChange?.(newLabels)

    // Update task if todoistId is provided
    if (todoistId) {
      try {
        await updateTask({
          todoistId,
          labels: newLabels
        })
      } catch (error) {
        console.error("Failed to update task labels:", error)
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={disabled}
        >
          <Tag className="h-3.5 w-3.5 mr-2" />
          {value.length > 0 ? (
            <span className="flex items-center gap-1">
              {value.slice(0, 2).map((label) => (
                <span key={label} className="text-xs">
                  {label}
                </span>
              ))}
              {value.length > 2 && (
                <span className="text-xs text-muted-foreground">
                  +{value.length - 2}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="max-h-64 overflow-auto">
          {activeLabels?.map((label) => {
            const isSelected = value.includes(label.name)

            return (
              <button
                key={label._id}
                onClick={() => handleToggleLabel(label.name)}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors",
                  isSelected && "bg-muted"
                )}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getProjectColor(label.color) }}
                />
                <span className="flex-1 text-left">{label.name}</span>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
              </button>
            )
          })}
          {(!activeLabels || activeLabels.length === 0) && (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No labels available
            </div>
          )}
        </div>
        {value.length > 0 && (
          <div className="border-t p-2">
            <Button
              size="sm"
              variant="ghost"
              className="w-full h-8 text-xs"
              onClick={async () => {
                onChange?.([])
                if (todoistId) {
                  await updateTask({ todoistId, labels: [] })
                }
                setOpen(false)
              }}
            >
              <X className="h-3 w-3 mr-2" />
              Clear all labels
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
