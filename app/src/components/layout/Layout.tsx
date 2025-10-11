import { useCallback, useMemo, useState } from "react"

import { TaskListView } from "../TaskListView"

import { Sidebar } from "./Sidebar"

import { useDialogContext } from "@/contexts/DialogContext"
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts"
import { useTaskCounts } from "@/hooks/useTaskCounts"
import { useTaskSelection } from "@/hooks/useTaskSelection"
import type { ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

export function Layout() {
  const { openShortcuts } = useDialogContext()
  const [activeView, setActiveView] = useState<ViewSelection>(() => resolveView("view:inbox"))

  const { updateTaskCount, resetTaskCounts, getTaskCounts } = useTaskCounts()

  const listIds = useMemo(() => activeView.lists.map((list) => list.id), [activeView.lists])

  const { selection, handleTaskCountChange, handleArrowNavigation, handleTaskClick } = useTaskSelection({
    listIds,
    getTaskCounts,
  })

  const handleViewChange = useCallback(
    (view: ViewSelection) => {
      setActiveView(view)
      resetTaskCounts()
    },
    [resetTaskCounts]
  )

  const handleTaskCountChangeWithUpdate = useCallback(
    (listId: string, count: number) => {
      updateTaskCount(listId, count)
      handleTaskCountChange(listId, count)
    },
    [updateTaskCount, handleTaskCountChange]
  )

  useGlobalShortcuts({
    onNavigateNext: () => handleArrowNavigation(1),
    onNavigatePrevious: () => handleArrowNavigation(-1),
    onShowHelp: openShortcuts,
  })

  const sidebarViewKey: ViewKey = activeView.key

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
        </div>
      </header>
      <div className="flex h-[calc(100vh-73px)]">
        <Sidebar currentViewKey={sidebarViewKey} onViewChange={handleViewChange} />
        <main className="flex-1 overflow-auto" data-task-scroll-container>
          <div className="space-y-6">
            {activeView.lists.map((list) => (
              <TaskListView
                key={list.id}
                list={list}
                onTaskCountChange={handleTaskCountChangeWithUpdate}
                onTaskClick={handleTaskClick}
                focusedTaskIndex={selection.listId === list.id ? selection.taskIndex : null}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}
