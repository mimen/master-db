import { useAction, useQuery } from "convex/react"
import { format, formatDistanceToNow } from "date-fns"
import { AlertTriangle, CalendarClock, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { useRoutineActions } from "@/hooks/useRoutineActions"
import { useTodoistAction } from "@/hooks/useTodoistAction"
import { ClearRoutineTasksDialog } from "./ClearRoutineTasksDialog"

interface SyncDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SyncDialog({ isOpen, onClose }: SyncDialogProps) {
  const syncStatus = useQuery(api.todoist.queries.getSyncStatus.getSyncStatus)
  const routineStatus = useQuery(api.routines.queries.getRoutineGenerationStatus.getRoutineGenerationStatus)
  const pendingRoutineTasks = useQuery(api.routines.queries.getPendingRoutineTasks.getPendingRoutineTasks)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isClearingRoutines, setIsClearingRoutines] = useState(false)
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)

  const performSync = useTodoistAction(api.todoist.actions.performIncrementalSync.performIncrementalSync, {
    loadingMessage: "Syncing with Todoist...",
    successMessage: "Sync completed successfully!",
    errorMessage: "Sync failed",
  })

  const { generateRoutineTasks } = useRoutineActions()

  const clearRoutineTasksAction = useAction(
    api.routines.actions.clearAllPendingRoutineTasks.clearAllPendingRoutineTasks
  )

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      await performSync({})
    } finally {
      setIsSyncing(false)
    }
  }, [performSync])

  const handleGenerateRoutines = useCallback(async () => {
    setIsGenerating(true)
    try {
      await generateRoutineTasks()
    } finally {
      setIsGenerating(false)
    }
  }, [generateRoutineTasks])

  const handleClearRoutineTasks = useCallback(async () => {
    setShowClearConfirmation(false)
    setIsClearingRoutines(true)

    const toastId = toast.loading("Clearing routine tasks...")

    try {
      const result = await clearRoutineTasksAction({})

      if (result?.success && result.data) {
        const { deleted, failed, skipped } = result.data
        toast.success(
          `Cleared ${deleted} task${deleted !== 1 ? 's' : ''} (${failed} failed, ${skipped} skipped)`,
          { id: toastId }
        )
      } else {
        toast.error(result?.error || "Failed to clear routine tasks", { id: toastId })
      }
    } catch (error) {
      toast.error("Failed to clear routine tasks", { id: toastId })
    } finally {
      setIsClearingRoutines(false)
    }
  }, [clearRoutineTasksAction])

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      } else if (event.key === "Enter" && !isSyncing) {
        event.preventDefault()
        handleSync()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose, isSyncing, handleSync])

  const formatSyncTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return {
      relative: formatDistanceToNow(date, { addSuffix: true }),
      absolute: format(date, "PPpp"),
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
              <RefreshCw className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <DialogTitle>Sync Status</DialogTitle>
              <DialogDescription>Todoist synchronization information</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sync Statistics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sync Statistics</CardTitle>
              <CardDescription>Last synchronization times and data counts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {syncStatus ? (
                <>
                  {/* Last Full Sync */}
                  <div className="flex items-start justify-between border-b pb-3">
                    <div>
                      <div className="text-sm font-medium">Last Full Sync</div>
                      <div className="text-xs text-muted-foreground">
                        {formatSyncTime(syncStatus.lastFullSync).relative}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      {formatSyncTime(syncStatus.lastFullSync).absolute}
                    </div>
                  </div>

                  {/* Last Incremental Sync */}
                  {syncStatus.lastIncrementalSync && (
                    <div className="flex items-start justify-between border-b pb-3">
                      <div>
                        <div className="text-sm font-medium">Last Incremental Sync</div>
                        <div className="text-xs text-muted-foreground">
                          {formatSyncTime(syncStatus.lastIncrementalSync).relative}
                        </div>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        {formatSyncTime(syncStatus.lastIncrementalSync).absolute}
                      </div>
                    </div>
                  )}

                  {/* Task Counts */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium">Active Tasks</div>
                      <div className="text-2xl font-bold">
                        {syncStatus.activeItemCount}
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          / {syncStatus.itemCount} total
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium">Active Projects</div>
                      <div className="text-2xl font-bold">
                        {syncStatus.activeProjectCount}
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          / {syncStatus.projectCount} total
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Sync Token Info */}
                  {syncStatus.syncToken && (
                    <div className="rounded-md bg-muted p-3">
                      <div className="text-xs font-medium text-muted-foreground">Sync Token</div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {syncStatus.syncToken.substring(0, 32)}...
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-24 w-full" />
                </>
              )}
            </CardContent>
          </Card>

          {/* Sync Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Todoist Sync</CardTitle>
              <CardDescription>Manually trigger synchronization</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleSync} disabled={isSyncing} className="w-full">
                <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                {isSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </CardContent>
          </Card>

          {/* Routine Task Generation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Routine Task Generation</CardTitle>
              <CardDescription>Generate upcoming routine tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {routineStatus ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium">Routines Needing Tasks</div>
                      <div className="text-2xl font-bold">
                        {routineStatus.routinesNeedingGeneration}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm font-medium">Pending Tasks</div>
                      <div className="text-2xl font-bold">
                        {routineStatus.pendingTasksCount}
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleGenerateRoutines} disabled={isGenerating} className="w-full">
                    <CalendarClock className={`mr-2 h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
                    {isGenerating ? "Generating..." : "Generate Routine Tasks"}
                  </Button>
                </>
              ) : (
                <>
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-10 w-full" />
                </>
              )}
            </CardContent>
          </Card>

          {/* Clear Routine Tasks */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clear Routine Tasks</CardTitle>
              <CardDescription>Delete all pending routine tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingRoutineTasks ? (
                <>
                  <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <div className="text-sm font-medium text-orange-900">
                      Pending Routine Tasks
                    </div>
                    <div className="text-2xl font-bold text-orange-700 mt-1">
                      {pendingRoutineTasks.count}
                    </div>
                    <div className="text-xs text-orange-700 mt-1">
                      Completed and historical tasks will be preserved
                    </div>
                  </div>
                  <Button
                    onClick={() => setShowClearConfirmation(true)}
                    disabled={isClearingRoutines || pendingRoutineTasks.count === 0}
                    variant="outline"
                    className="w-full border-orange-300 hover:bg-orange-50"
                  >
                    <AlertTriangle className="mr-2 h-4 w-4 text-orange-600" />
                    Clear All Pending Tasks
                  </Button>
                </>
              ) : (
                <>
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-10 w-full" />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
      <ClearRoutineTasksDialog
        isOpen={showClearConfirmation}
        pendingTaskCount={pendingRoutineTasks?.count || 0}
        onConfirm={handleClearRoutineTasks}
        onClose={() => setShowClearConfirmation(false)}
        isClearing={isClearingRoutines}
      />
    </Dialog>
  )
}
