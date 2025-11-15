import { Pause, Play, Repeat } from "lucide-react"
import { memo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useRoutineActions } from "@/hooks/useRoutineActions"
import { cn } from "@/lib/utils"
import type { Doc } from "@/convex/_generated/dataModel"

interface RoutineRowProps {
  routine: Doc<"routines">
  onElementRef: (element: HTMLDivElement | null) => void
  onClick?: () => void
}

// Helper to get frequency display color
function getFrequencyColor(frequency: string): string {
  if (frequency === "Daily" || frequency === "Twice a Week") {
    return "text-green-600 dark:text-green-400"
  }
  if (frequency === "Weekly" || frequency === "Every Other Week") {
    return "text-blue-600 dark:text-blue-400"
  }
  return "text-purple-600 dark:text-purple-400"
}

// Helper to get completion rate color
function getCompletionRateColor(rate: number): string {
  if (rate >= 80) return "text-green-600 dark:text-green-400"
  if (rate >= 50) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

export const RoutineRow = memo(function RoutineRow({ routine, onElementRef, onClick }: RoutineRowProps) {
  const frequencyColor = getFrequencyColor(routine.frequency)
  const completionRateColor = getCompletionRateColor(routine.completionRateOverall)
  const { deferRoutine, undeferRoutine } = useRoutineActions()
  const [isToggling, setIsToggling] = useState(false)

  const handleToggleDefer = async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent opening dialog

    setIsToggling(true)
    try {
      if (routine.defer) {
        await undeferRoutine(routine._id)
      } else {
        await deferRoutine(routine._id)
      }
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div
      ref={onElementRef}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 hover:bg-accent cursor-pointer transition-colors",
        routine.defer && "opacity-60"
      )}
    >
      {/* Routine Icon */}
      <Repeat className="h-4 w-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />

      {/* Routine Name and Description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{routine.name}</span>

          {/* Frequency Badge */}
          <Badge variant="outline" className={cn("text-xs font-normal", frequencyColor)}>
            {routine.frequency}
          </Badge>

          {/* Defer Badge */}
          {routine.defer && (
            <Badge variant="outline" className="text-xs font-normal text-gray-500">
              Paused
            </Badge>
          )}
        </div>

        {/* Description */}
        {routine.description && (
          <div className="text-sm text-muted-foreground truncate mt-0.5">
            {routine.description}
          </div>
        )}
      </div>

      {/* Completion Rate & Defer Toggle */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          <div className={cn("text-sm font-medium", completionRateColor)}>
            {routine.completionRateOverall}%
          </div>
          <div className="text-xs text-muted-foreground">
            {routine.duration}
          </div>
        </div>

        {/* Defer Toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleToggleDefer}
                disabled={isToggling}
              >
                {routine.defer ? (
                  <Play className="h-4 w-4 text-green-600" />
                ) : (
                  <Pause className="h-4 w-4 text-gray-600" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {routine.defer ? "Resume routine" : "Pause routine"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
})
