import { useQuery } from "convex/react"
import { CheckCircle2, Circle, Clock, Edit, Minus, Pause, Play, X } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useRoutineActions } from "@/hooks/useRoutineActions"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

interface RoutineDetailDialogProps {
  isOpen: boolean
  onClose: () => void
  routineId: Id<"routines"> | null
  onEdit?: () => void
}

// Helper to get status icon and color
function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />
    case "missed":
      return <X className="h-4 w-4 text-red-600" />
    case "skipped":
      return <Minus className="h-4 w-4 text-gray-400" />
    case "pending":
      return <Clock className="h-4 w-4 text-blue-600" />
    case "deferred":
      return <Minus className="h-4 w-4 text-gray-400" />
    default:
      return <Circle className="h-4 w-4 text-gray-400" />
  }
}

// Helper to get completion rate color
function getCompletionRateColor(rate: number): string {
  if (rate >= 80) return "text-green-600 dark:text-green-400"
  if (rate >= 50) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

// Helper to format date
function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const diffDays = Math.floor((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Tomorrow"
  if (diffDays === -1) return "Yesterday"
  if (diffDays > 1 && diffDays < 7) return `in ${diffDays} days`
  if (diffDays < -1 && diffDays > -7) return `${Math.abs(diffDays)} days ago`

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function RoutineDetailDialog({
  isOpen,
  onClose,
  routineId,
  onEdit,
}: RoutineDetailDialogProps) {
  const stats = useQuery(
    api.routines.queries.getRoutineStats.getRoutineStats,
    routineId ? { routineId } : "skip"
  )
  const { deferRoutine, undeferRoutine } = useRoutineActions()
  const [isToggling, setIsToggling] = useState(false)

  const handleToggleDefer = async () => {
    if (!routineId) return

    setIsToggling(true)
    try {
      if (stats?.routine.defer) {
        await undeferRoutine(routineId)
      } else {
        await deferRoutine(routineId)
      }
    } finally {
      setIsToggling(false)
    }
  }

  if (!stats) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Routine Details</DialogTitle>
            <DialogDescription className="sr-only">Loading routine information</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">Loading routine details...</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const { routine, recentTasks, nextTaskDate } = stats
  const overallRateColor = getCompletionRateColor(stats.completionRateOverall)
  const monthlyRateColor = getCompletionRateColor(stats.completionRateMonth)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <DialogTitle>{routine.name}</DialogTitle>
              {routine.description ? (
                <DialogDescription className="mt-2">{routine.description}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">View routine details and statistics</DialogDescription>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleDefer}
                disabled={isToggling}
              >
                {routine.defer ? (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </>
                )}
              </Button>
              {onEdit && (
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Routine Properties */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">Properties</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Frequency</div>
                <div className="text-sm font-medium">{routine.frequency}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="text-sm font-medium">{routine.duration}</div>
              </div>
              {routine.category && (
                <div>
                  <div className="text-xs text-muted-foreground">Category</div>
                  <div className="text-sm font-medium">{routine.category}</div>
                </div>
              )}
              {routine.timeOfDay && (
                <div>
                  <div className="text-xs text-muted-foreground">Time of Day</div>
                  <div className="text-sm font-medium">{routine.timeOfDay}</div>
                </div>
              )}
            </div>
            {routine.defer && (
              <Badge variant="outline" className="text-xs font-normal text-gray-500">
                Paused
              </Badge>
            )}
          </div>

          <Separator />

          {/* Completion Rates */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">
              Completion Stats
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Overall Completion Rate</div>
                <div className={cn("text-2xl font-bold", overallRateColor)}>
                  {stats.completionRateOverall}%
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">This Month</div>
                <div className={cn("text-2xl font-bold", monthlyRateColor)}>
                  {stats.completionRateMonth}%
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 pt-2">
              <div>
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-sm font-medium text-green-600">{stats.completedCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Pending</div>
                <div className="text-sm font-medium text-blue-600">{stats.pendingCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Missed</div>
                <div className="text-sm font-medium text-red-600">{stats.missedCount}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Skipped</div>
                <div className="text-sm font-medium text-gray-500">{stats.skippedCount}</div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Next Task */}
          {nextTaskDate && (
            <>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase">
                  Next Scheduled
                </h3>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">{formatDate(nextTaskDate)}</span>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Recent Tasks */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">
              Recent Tasks (Last 30 Days)
            </h3>
            {recentTasks.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">No tasks generated yet</div>
            ) : (
              <div className="space-y-2">
                {recentTasks.map((task: Doc<"routineTasks">) => (
                  <div
                    key={task._id}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-accent"
                  >
                    {getStatusIcon(task.status)}
                    <div className="flex-1">
                      <div className="text-sm">{formatDate(task.readyDate)}</div>
                      {task.completedDate && (
                        <div className="text-xs text-muted-foreground">
                          Completed {formatDate(task.completedDate)}
                        </div>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs capitalize",
                        task.status === "completed" && "text-green-600 border-green-600",
                        task.status === "missed" && "text-red-600 border-red-600",
                        task.status === "pending" && "text-blue-600 border-blue-600",
                        (task.status === "skipped" || task.status === "deferred") &&
                          "text-gray-500 border-gray-500"
                      )}
                    >
                      {task.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
