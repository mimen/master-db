import { useQuery } from "convex/react"
import { Plus, RotateCcw, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { RoutineDetailDialog } from "./dialogs/RoutineDetailDialog"
import { RoutineDialog } from "./dialogs/RoutineDialog"
import { RoutineRow } from "./RoutineRow"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useFocusContext } from "@/contexts/FocusContext"
import { useCountRegistry } from "@/contexts/CountContext"
import { useRoutineActions } from "@/hooks/useRoutineActions"
import { useRoutineDialogShortcuts } from "@/hooks/useRoutineDialogShortcuts"
import { useListItemFocus } from "@/hooks/list-items"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import type { ListInstance } from "@/lib/views/types"

interface RoutinesListViewProps {
  list: ListInstance
  onRoutineCountChange?: (listId: string, count: number) => void
  onRoutineClick?: (listId: string, routineIndex: number) => void
  focusedRoutineIndex: number | null
  isDismissed?: boolean // Not used yet but kept for interface consistency
  onDismiss?: (listId: string) => void // Not used yet but kept for interface consistency
  onRestore?: (listId: string) => void // Not used yet but kept for interface consistency
  isMultiListView?: boolean
}

export function RoutinesListView({
  list,
  onRoutineCountChange,
  onRoutineClick,
  focusedRoutineIndex,
  isMultiListView = false,
}: RoutinesListViewProps) {
  const [isExpanded, setIsExpanded] = useState(list.startExpanded)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [selectedRoutine, setSelectedRoutine] = useState<Doc<"routines"> | undefined>()
  const { registry } = useCountRegistry()
  const { setFocusedRoutine } = useFocusContext()

  const handleOpenCreate = () => {
    setSelectedRoutine(undefined)
    setIsDialogOpen(true)
  }

  const handleOpenDetail = (routine: Doc<"routines">) => {
    setSelectedRoutine(routine)
    setIsDetailDialogOpen(true)
  }

  const handleOpenEdit = (routine: Doc<"routines">) => {
    setSelectedRoutine(routine)
    setIsDialogOpen(true)
  }

  const { deferRoutine, undeferRoutine } = useRoutineActions()

  const handleTogglePause = async (routine: Doc<"routines">) => {
    if (routine.defer) {
      await undeferRoutine(routine._id)
    } else {
      await deferRoutine(routine._id)
    }
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setSelectedRoutine(undefined)
  }

  const handleCloseDetailDialog = () => {
    setIsDetailDialogOpen(false)
    setSelectedRoutine(undefined)
  }

  const allRoutines: Doc<"routines">[] | undefined = useQuery(
    api.routines.queries.getRoutinesByView.getRoutinesByView,
    {
      list: {
        type: "routines",
        view: list.query.view,
      },
    }
  )

  const visibleRoutines = useMemo(() => {
    if (!allRoutines) return []
    if (!isExpanded && isMultiListView) return []

    const maxRoutines = list.maxTasks
    if (maxRoutines && allRoutines.length > maxRoutines) {
      return allRoutines.slice(0, maxRoutines)
    }
    return allRoutines
  }, [allRoutines, isExpanded, isMultiListView, list.maxTasks])

  // Notify parent of routine count changes
  useEffect(() => {
    if (onRoutineCountChange && allRoutines) {
      onRoutineCountChange(list.id, allRoutines.length)
    }
  }, [list.id, allRoutines, onRoutineCountChange])

  const routineRefs = useRef<(HTMLDivElement | null)[]>([])
  routineRefs.current.length = visibleRoutines.length

  const focusedRoutine =
    focusedRoutineIndex !== null && focusedRoutineIndex >= 0 && focusedRoutineIndex < visibleRoutines.length
      ? visibleRoutines[focusedRoutineIndex]
      : null

  // Update FocusContext when focused routine changes
  useEffect(() => {
    setFocusedRoutine(focusedRoutine)
  }, [focusedRoutine, setFocusedRoutine])

  // Enable keyboard shortcuts for property editing
  useRoutineDialogShortcuts(focusedRoutine)

  // Use shared focus management hook
  useListItemFocus({
    entityType: 'routine',
    focusedIndex: focusedRoutineIndex,
    entitiesLength: visibleRoutines.length,
    elementRefs: routineRefs,
    onExpand: () => setIsExpanded(true)
  })

  const isLoading = allRoutines === undefined

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">Loading routines...</div>
        </div>
      </div>
    )
  }

  const count = registry.getCountForList(list.id, list.query)
  const headerInfo = list.getHeader({
    params: list.params,
    taskCount: count,
    support: {},
  })

  const emptyStateInfo = list.getEmptyState({
    params: list.params,
    taskCount: 0,
    support: {},
  })

  const hasMaxRoutines = list.maxTasks !== undefined
  const isShowingAll = !hasMaxRoutines || allRoutines.length <= (list.maxTasks ?? 0)
  const hiddenCount = hasMaxRoutines && !isShowingAll ? allRoutines.length - (list.maxTasks ?? 0) : 0

  return (
    <>
      <RoutineDetailDialog
        isOpen={isDetailDialogOpen}
        onClose={handleCloseDetailDialog}
        routineId={selectedRoutine?._id || null}
      />
      <RoutineDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        routine={selectedRoutine}
        mode={selectedRoutine ? "edit" : "create"}
      />

      <div className="space-y-4">
        {/* Header with New button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1">
            {isMultiListView && (
              <div className="flex items-center gap-3 mb-3">
                <div className="text-muted-foreground">{headerInfo.icon}</div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{headerInfo.title}</h2>
                  {headerInfo.description && (
                    <p className="text-sm text-muted-foreground">{headerInfo.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!isShowingAll && (
                    <span className="text-xs text-muted-foreground">
                      +{hiddenCount} more
                    </span>
                  )}
                  <div className="text-sm text-muted-foreground">{count}</div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setIsExpanded(!isExpanded)}
                        >
                          {isExpanded ? (
                            <X className="h-4 w-4" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isExpanded ? "Collapse" : "Expand"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}
          </div>
          <Button onClick={handleOpenCreate} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Routine
          </Button>
        </div>

        {isMultiListView && <Separator />}

      {visibleRoutines.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <p className="text-lg font-semibold text-muted-foreground">{emptyStateInfo.title}</p>
            {emptyStateInfo.description && (
              <p className="text-sm text-muted-foreground mt-1">{emptyStateInfo.description}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-px">
          {visibleRoutines.map((routine, index) => (
            <RoutineRow
              key={routine._id}
              routine={routine}
              onElementRef={(el) => routineRefs.current[index] = el}
              onClick={() => onRoutineClick?.(list.id, index)}
              onOpenDetail={handleOpenDetail}
              onOpenEdit={handleOpenEdit}
              onTogglePause={handleTogglePause}
            />
          ))}
        </div>
      )}
    </div>
    </>
  )
}
