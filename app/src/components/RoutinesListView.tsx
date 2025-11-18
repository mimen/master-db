import { useQuery } from "convex/react"
import { Plus } from "lucide-react"
import { useState } from "react"

import { RoutineDetailDialog } from "./dialogs/RoutineDetailDialog"
import { RoutineDialog } from "./dialogs/RoutineDialog"

import { BaseListView, RoutineListItem } from "@/components/list-items"
import { Button } from "@/components/ui/button"
import { useFocusContext } from "@/contexts/FocusContext"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { useRoutineDialogShortcuts } from "@/hooks/useRoutineDialogShortcuts"
import type { ListInstance } from "@/lib/views/types"

interface RoutinesListViewProps {
  list: ListInstance
  onRoutineCountChange?: (listId: string, count: number) => void
  onRoutineClick?: (listId: string, routineIndex: number) => void
  focusedRoutineIndex: number | null
  isDismissed?: boolean
  onDismiss?: (listId: string) => void
  onRestore?: (listId: string) => void
  isMultiListView?: boolean
}

export function RoutinesListView({
  list,
  onRoutineCountChange,
  onRoutineClick,
  focusedRoutineIndex,
  isDismissed = false,
  onDismiss,
  onRestore,
  isMultiListView = false,
}: RoutinesListViewProps) {
  // Dialog state (local for now, will be moved to DialogManager in future)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false)
  const [selectedRoutine, setSelectedRoutine] = useState<Doc<"routines"> | undefined>()

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

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setSelectedRoutine(undefined)
  }

  const handleCloseDetailDialog = () => {
    setIsDetailDialogOpen(false)
    setSelectedRoutine(undefined)
  }

  // Fetch routines
  const allRoutines: Doc<"routines">[] | undefined = useQuery(
    api.routines.queries.getRoutinesByView.getRoutinesByView,
    {
      list: {
        type: "routines",
        view: list.query.view,
      },
    }
  )

  const visibleRoutines = allRoutines ? (list.maxTasks ? allRoutines.slice(0, list.maxTasks) : allRoutines) : []
  const isLoading = allRoutines === undefined

  // BaseListView handles all list-level rendering (header, empty state, collapse, focus, count)
  return (
    <>
      {/* Routine dialogs - will be moved to DialogManager in future */}
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

      {/* "New Routine" button container */}
      <div className="flex items-center justify-end mb-4">
        <Button onClick={handleOpenCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Routine
        </Button>
      </div>

      {/* List view */}
      <BaseListView<Doc<"routines">>
        entities={visibleRoutines}
        entityType="routine"
        getEntityId={(routine) => routine._id}
        list={list}
        isMultiListView={isMultiListView}
        isDismissed={isDismissed}
        onDismiss={onDismiss}
        onRestore={onRestore}
        isLoading={isLoading}
        focusedIndex={focusedRoutineIndex}
        setFocusedEntity={() => {}}
        setFocusedEntityInContext={setFocusedRoutine}
        useEntityShortcuts={useRoutineDialogShortcuts}
        onEntityCountChange={onRoutineCountChange}
        onEntityClick={onRoutineClick}
        renderRow={(routine, index, ref) => (
          <RoutineListItem
            key={routine._id}
            routine={routine}
            onElementRef={ref}
            onClick={() => onRoutineClick?.(list.id, index)}
            onOpenDetail={handleOpenDetail}
            onOpenEdit={handleOpenEdit}
          />
        )}
      />
    </>
  )
}
