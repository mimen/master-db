import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { TaskListView } from "../TaskListView"

import { Sidebar } from "./Sidebar"

import { useDialogContext } from "@/contexts/OverlayContext"
import type { ViewConfig } from "@/types/views"

type Selection = {
  viewId: string | null
  taskIndex: number | null
}

export function Layout() {
  const { openShortcuts } = useDialogContext()
  const [activeViews, setActiveViews] = useState<ViewConfig[]>([
    { id: "main", type: "inbox", value: "inbox", expanded: true, collapsible: false }
  ])
  const [selectionState, setSelectionState] = useState<Selection>({ viewId: null, taskIndex: null })
  const viewTaskCountsRef = useRef(new Map<string, number>())

  const updateSelection = useCallback((updater: (prev: Selection) => Selection) => {
    setSelectionState((prev) => {
      const next = updater(prev)
      return next
    })
  }, [])

  const viewIds = useMemo(() => activeViews.map((view) => view.id), [activeViews])

  const handleViewChange = useCallback((views: ViewConfig[]) => {
    setActiveViews(views)
  }, [])

  const handleTaskCountChange = useCallback((viewId: string, count: number) => {
    viewTaskCountsRef.current.set(viewId, count)

    updateSelection((prev) => {
      if (!prev.viewId || prev.taskIndex === null) {
        const firstAvailable = findFirstAvailable(viewIds, viewTaskCountsRef.current)
        return firstAvailable ?? prev
      }

      if (prev.viewId === viewId) {
        if (count === 0) {
          const next = findNextView(viewIds, viewTaskCountsRef.current, viewId)
            ?? findPreviousView(viewIds, viewTaskCountsRef.current, viewId)
          return next ?? { viewId: null, taskIndex: null }
        }

        if (prev.taskIndex >= count) {
          return { viewId, taskIndex: count - 1 }
        }
      }

      return prev
    })
  }, [updateSelection, viewIds])

  const handleTaskClick = useCallback((viewId: string, taskIndex: number) => {
    updateSelection(() => ({ viewId, taskIndex }))
  }, [updateSelection])

  const handleArrowNavigation = useCallback((direction: 1 | -1) => {
    updateSelection((prev) => {
      if (viewIds.length === 0) return prev

      const counts = viewTaskCountsRef.current
      const movingForward = direction === 1

      if (!prev.viewId || prev.taskIndex === null) {
        const fallback = movingForward
          ? findFirstAvailable(viewIds, counts)
          : findLastAvailable(viewIds, counts)
        return fallback ?? prev
      }

      const currentIndex = viewIds.indexOf(prev.viewId)
      if (currentIndex === -1) {
        const fallback = movingForward
          ? findFirstAvailable(viewIds, counts)
          : findLastAvailable(viewIds, counts)
        return fallback ?? { viewId: null, taskIndex: null }
      }

      const currentCount = counts.get(prev.viewId) ?? 0

      if (currentCount === 0) {
        const fallback = movingForward
          ? findNextView(viewIds, counts, prev.viewId)
          : findPreviousView(viewIds, counts, prev.viewId)
        return fallback ?? { viewId: null, taskIndex: null }
      }

      if (movingForward) {
        if ((prev.taskIndex ?? 0) + 1 < currentCount) {
          return { viewId: prev.viewId, taskIndex: (prev.taskIndex ?? 0) + 1 }
        }
        const next = findNextView(viewIds, counts, prev.viewId)
        return next ?? prev
      }

      if ((prev.taskIndex ?? 0) > 0) {
        return { viewId: prev.viewId, taskIndex: (prev.taskIndex ?? 0) - 1 }
      }
      const previous = findPreviousView(viewIds, counts, prev.viewId)
      return previous ?? prev
    })
  }, [updateSelection, viewIds])

  useEffect(() => {
    updateSelection((prev) => {
      if (!prev.viewId || !viewIds.includes(prev.viewId)) {
        const fallback = findFirstAvailable(viewIds, viewTaskCountsRef.current)
        return fallback ?? { viewId: null, taskIndex: null }
      }

      const currentCount = viewTaskCountsRef.current.get(prev.viewId) ?? 0
      if (currentCount === 0) {
        const fallback = findNextView(viewIds, viewTaskCountsRef.current, prev.viewId)
          ?? findPreviousView(viewIds, viewTaskCountsRef.current, prev.viewId)
        return fallback ?? { viewId: null, taskIndex: null }
      }

      if ((prev.taskIndex ?? 0) >= currentCount) {
        return { viewId: prev.viewId, taskIndex: currentCount - 1 }
      }

      return prev
    })
  }, [updateSelection, viewIds])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        event.preventDefault()
        return
      }

      const target = event.target as HTMLElement | null
      const isEditable = target?.isContentEditable
      const tagName = target?.tagName
      const isTextInput = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || isEditable

      if (isTextInput) return

      // Global shortcuts
      if (event.key === "?" && event.shiftKey) {
        event.preventDefault()
        openShortcuts()
        return
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault()
        handleArrowNavigation(1)
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault()
        handleArrowNavigation(-1)
      }
    }

    const eventTarget =
      typeof window !== "undefined"
        ? window
        : undefined

    eventTarget?.addEventListener("keydown", handleKeyDown)
    return () => {
      eventTarget?.removeEventListener("keydown", handleKeyDown)
    }
  }, [handleArrowNavigation, openShortcuts])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
        </div>
      </header>
      <div className="flex h-[calc(100vh-73px)]">
        <Sidebar
          currentView={activeViews[0]?.value || "inbox"}
          onViewChange={handleViewChange}
        />
        <main className="flex-1 overflow-auto" data-task-scroll-container>
          <div className="space-y-6">
            {activeViews.map((view) => (
              <TaskListView
                key={view.id}
                viewConfig={view}
                onTaskCountChange={handleTaskCountChange}
                onTaskClick={handleTaskClick}
                focusedTaskIndex={
                  selectionState.viewId === view.id ? selectionState.taskIndex : null
                }
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

function findFirstAvailable(viewIds: string[], counts: Map<string, number>): Selection | null {
  for (const viewId of viewIds) {
    const count = counts.get(viewId) ?? 0
    if (count > 0) {
      return { viewId, taskIndex: 0 }
    }
  }
  return null
}

function findLastAvailable(viewIds: string[], counts: Map<string, number>): Selection | null {
  for (let index = viewIds.length - 1; index >= 0; index -= 1) {
    const viewId = viewIds[index]
    const count = counts.get(viewId) ?? 0
    if (count > 0) {
      return { viewId, taskIndex: count - 1 }
    }
  }
  return null
}

function findNextView(viewIds: string[], counts: Map<string, number>, currentViewId: string): Selection | null {
  const startIndex = viewIds.indexOf(currentViewId)
  if (startIndex === -1) return null

  for (let index = startIndex + 1; index < viewIds.length; index += 1) {
    const viewId = viewIds[index]
    const count = counts.get(viewId) ?? 0
    if (count > 0) {
      return { viewId, taskIndex: 0 }
    }
  }

  return null
}

function findPreviousView(viewIds: string[], counts: Map<string, number>, currentViewId: string): Selection | null {
  const startIndex = viewIds.indexOf(currentViewId)
  if (startIndex === -1) return null

  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const viewId = viewIds[index]
    const count = counts.get(viewId) ?? 0
    if (count > 0) {
      return { viewId, taskIndex: count - 1 }
    }
  }

  return null
}
