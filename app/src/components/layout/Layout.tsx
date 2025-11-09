import { useCallback, useMemo, useState } from "react"

import { TaskListView } from "../TaskListView"

import { Sidebar } from "./Sidebar"

import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { useDialogContext } from "@/contexts/DialogContext"
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts"
import { useTaskCounts } from "@/hooks/useTaskCounts"
import { useTaskSelection } from "@/hooks/useTaskSelection"
import type { ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

export function Layout() {
  const { openShortcuts } = useDialogContext()
  const [activeView, setActiveView] = useState<ViewSelection>(() => resolveView("view:inbox"))
  const [dismissedLists, setDismissedLists] = useState<Set<string>>(new Set())
  const [taskCountsAtDismissal, setTaskCountsAtDismissal] = useState<Map<string, number>>(new Map())

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

      // Auto-restore dismissed lists ONLY when task count increases
      if (dismissedLists.has(listId)) {
        const countAtDismissal = taskCountsAtDismissal.get(listId) ?? 0
        if (count > countAtDismissal) {
          setDismissedLists((prev) => {
            const next = new Set(prev)
            next.delete(listId)
            return next
          })
          setTaskCountsAtDismissal((prev) => {
            const next = new Map(prev)
            next.delete(listId)
            return next
          })
        }
      }
    },
    [updateTaskCount, handleTaskCountChange, dismissedLists, taskCountsAtDismissal]
  )

  const handleDismissList = useCallback((listId: string) => {
    const currentCount = getTaskCounts().get(listId) ?? 0
    setDismissedLists((prev) => new Set(prev).add(listId))
    setTaskCountsAtDismissal((prev) => new Map(prev).set(listId, currentCount))
  }, [getTaskCounts])

  const handleRestoreList = useCallback((listId: string) => {
    setDismissedLists((prev) => {
      const next = new Set(prev)
      next.delete(listId)
      return next
    })
    setTaskCountsAtDismissal((prev) => {
      const next = new Map(prev)
      next.delete(listId)
      return next
    })
  }, [])

  useGlobalShortcuts({
    onNavigateNext: () => handleArrowNavigation(1),
    onNavigatePrevious: () => handleArrowNavigation(-1),
    onShowHelp: openShortcuts,
  })

  const sidebarViewKey: ViewKey = activeView.key
  const isMultiListView = activeView.lists.length > 1

  return (
    <>
      <Sidebar currentViewKey={sidebarViewKey} onViewChange={handleViewChange} />
      <SidebarInset className="overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="h-6 w-px bg-border" />
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
        </header>
        <ScrollArea className="h-[calc(100vh-4rem)]" data-task-scroll-container>
          <main className="space-y-6 p-6">
            {activeView.lists.map((list) => (
              <TaskListView
                key={list.id}
                list={list}
                onTaskCountChange={handleTaskCountChangeWithUpdate}
                onTaskClick={handleTaskClick}
                focusedTaskIndex={selection.listId === list.id ? selection.taskIndex : null}
                isDismissed={dismissedLists.has(list.id)}
                onDismiss={handleDismissList}
                onRestore={handleRestoreList}
                isMultiListView={isMultiListView}
              />
            ))}
          </main>
        </ScrollArea>
      </SidebarInset>
    </>
  )
}
