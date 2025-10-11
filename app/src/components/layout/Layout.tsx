import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { TaskListView } from "../TaskListView"

import { Sidebar } from "./Sidebar"

import { useDialogContext } from "@/contexts/DialogContext"
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts"
import type { ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"

type Selection = {
  listId: string | null
  taskIndex: number | null
}

export function Layout() {
  const { openShortcuts } = useDialogContext()
  const [activeView, setActiveView] = useState<ViewSelection>(() => resolveView("view:inbox"))
  const [selectionState, setSelectionState] = useState<Selection>({ listId: null, taskIndex: null })
  const taskCountsRef = useRef(new Map<string, number>())

  const updateSelection = useCallback((updater: (prev: Selection) => Selection) => {
    setSelectionState((prev) => updater(prev))
  }, [])

  const listIds = useMemo(() => activeView.lists.map((list) => list.id), [activeView.lists])

  const handleViewChange = useCallback((view: ViewSelection) => {
    setActiveView(view)
    taskCountsRef.current = new Map<string, number>()
    setSelectionState({ listId: null, taskIndex: null })
  }, [])

  const handleTaskCountChange = useCallback((listId: string, count: number) => {
    taskCountsRef.current.set(listId, count)

    updateSelection((prev) => {
      if (!prev.listId || prev.taskIndex === null) {
        const firstAvailable = findFirstAvailableList(listIds, taskCountsRef.current)
        return firstAvailable ?? prev
      }

      if (prev.listId === listId) {
        if (count === 0) {
          const next =
            findNextList(listIds, taskCountsRef.current, listId) ??
            findPreviousList(listIds, taskCountsRef.current, listId)
          return next ?? { listId: null, taskIndex: null }
        }

        if (prev.taskIndex >= count) {
          return { listId, taskIndex: count - 1 }
        }
      }

      return prev
    })
  }, [listIds, updateSelection])

  const handleTaskClick = useCallback((listId: string, taskIndex: number) => {
    updateSelection(() => ({ listId, taskIndex }))
  }, [updateSelection])

  const handleArrowNavigation = useCallback(
    (direction: 1 | -1) => {
      updateSelection((prev) => {
        if (listIds.length === 0) return prev

        const counts = taskCountsRef.current
        const movingForward = direction === 1

        if (!prev.listId || prev.taskIndex === null) {
          const fallback = movingForward
            ? findFirstAvailableList(listIds, counts)
            : findLastAvailableList(listIds, counts)
          return fallback ?? prev
        }

        const currentIndex = listIds.indexOf(prev.listId)
        if (currentIndex === -1) {
          const fallback = movingForward
            ? findFirstAvailableList(listIds, counts)
            : findLastAvailableList(listIds, counts)
          return fallback ?? { listId: null, taskIndex: null }
        }

        const currentCount = counts.get(prev.listId) ?? 0

        if (currentCount === 0) {
          const fallback = movingForward
            ? findNextList(listIds, counts, prev.listId)
            : findPreviousList(listIds, counts, prev.listId)
          return fallback ?? { listId: null, taskIndex: null }
        }

        if (movingForward) {
          if ((prev.taskIndex ?? 0) + 1 < currentCount) {
            return { listId: prev.listId, taskIndex: (prev.taskIndex ?? 0) + 1 }
          }
          const next = findNextList(listIds, counts, prev.listId)
          return next ?? prev
        }

        if ((prev.taskIndex ?? 0) > 0) {
          return { listId: prev.listId, taskIndex: (prev.taskIndex ?? 0) - 1 }
        }
        const previous = findPreviousList(listIds, counts, prev.listId)
        return previous ?? prev
      })
    },
    [listIds, updateSelection]
  )

  useEffect(() => {
    updateSelection((prev) => {
      if (!prev.listId || !listIds.includes(prev.listId)) {
        const fallback = findFirstAvailableList(listIds, taskCountsRef.current)
        return fallback ?? { listId: null, taskIndex: null }
      }

      const currentCount = taskCountsRef.current.get(prev.listId) ?? 0
      if (currentCount === 0) {
        const fallback =
          findNextList(listIds, taskCountsRef.current, prev.listId) ??
          findPreviousList(listIds, taskCountsRef.current, prev.listId)
        return fallback ?? { listId: null, taskIndex: null }
      }

      if ((prev.taskIndex ?? 0) >= currentCount) {
        return { listId: prev.listId, taskIndex: currentCount - 1 }
      }

      return prev
    })
  }, [listIds, updateSelection])

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
                onTaskCountChange={handleTaskCountChange}
                onTaskClick={handleTaskClick}
                focusedTaskIndex={
                  selectionState.listId === list.id ? selectionState.taskIndex : null
                }
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

function findFirstAvailableList(listIds: string[], counts: Map<string, number>): Selection | null {
  for (const listId of listIds) {
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: 0 }
    }
  }
  return null
}

function findLastAvailableList(listIds: string[], counts: Map<string, number>): Selection | null {
  for (let index = listIds.length - 1; index >= 0; index -= 1) {
    const listId = listIds[index]
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: count - 1 }
    }
  }
  return null
}

function findNextList(
  listIds: string[],
  counts: Map<string, number>,
  currentListId: string
): Selection | null {
  const startIndex = listIds.indexOf(currentListId)
  if (startIndex === -1) return null

  for (let index = startIndex + 1; index < listIds.length; index += 1) {
    const listId = listIds[index]
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: 0 }
    }
  }

  return null
}

function findPreviousList(
  listIds: string[],
  counts: Map<string, number>,
  currentListId: string
): Selection | null {
  const startIndex = listIds.indexOf(currentListId)
  if (startIndex === -1) return null

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const listId = listIds[index]
    const count = counts.get(listId) ?? 0
    if (count > 0) {
      return { listId, taskIndex: count - 1 }
    }
  }

  return null
}
