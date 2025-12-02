import { useQuery } from "convex/react"
import { Keyboard, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocation } from "wouter"

import { ProjectsListView } from "../ProjectsListView"
import { RoutinesListView } from "../RoutinesListView"
import { TaskListView } from "../TaskListView"
import { ThemeToggle } from "../ThemeToggle"

import { Sidebar } from "./Sidebar"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { useCountRegistry } from "@/contexts/CountContext"
import { useDialogContext } from "@/contexts/DialogContext"
import { useHeaderSlot } from "@/contexts/HeaderSlotContext"
import { api } from "@/convex/_generated/api"
import { useTaskCounts } from "@/hooks/useTaskCounts"
import { useTaskSelection } from "@/hooks/useTaskSelection"
import { pathToViewKey, viewKeyToPath } from "@/lib/routing/utils"
import type { ViewBuildContext, ViewKey, ViewSelection } from "@/lib/views/types"
import { resolveView } from "@/lib/views/viewDefinitions"
import type { TodoistLabelDoc, TodoistProjects, TodoistProjectsWithMetadata } from "@/types/convex/todoist"

export function Layout() {
  const { openShortcuts, openQuickAdd, openSync } = useDialogContext()
  const { getCountForView } = useCountRegistry()
  const [location, setLocation] = useLocation()

  // Initialize active view from URL (we'll update this in useEffect once viewContext loads)
  const [activeView, setActiveView] = useState<ViewSelection>(() => resolveView("view:inbox"))
  const [dismissedLists, setDismissedLists] = useState<Set<string>>(new Set())
  const [taskCountsAtDismissal, setTaskCountsAtDismissal] = useState<Map<string, number>>(new Map())

  // Fetch data needed for viewContext
  const projects = useQuery(api.todoist.queries.getProjects.getProjects) as TodoistProjects | undefined
  const projectsWithMetadata = useQuery(api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata, {}) as
    | TodoistProjectsWithMetadata
    | undefined
  const labels = useQuery(api.todoist.queries.getLabels.getLabels) as TodoistLabelDoc[] | undefined

  // Build viewContext
  const viewContext: ViewBuildContext = useMemo(
    () => ({
      projects,
      projectsWithMetadata,
      labels,
    }),
    [projects, projectsWithMetadata, labels]
  )

  // Use CountRegistry for instant total count WITH viewContext
  const totalTaskCount = getCountForView(activeView.key, viewContext)

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
      // Update URL when view changes (pass viewContext for project slugs)
      const path = viewKeyToPath(view.key, viewContext)
      setLocation(path)
    },
    [resetTaskCounts, setLocation, viewContext]
  )

  // Sync view when URL changes (browser back/forward, direct navigation)
  // Also handles initial load from URL
  useEffect(() => {
    const viewKey = pathToViewKey(location, viewContext)
    if (viewKey && viewKey !== activeView.key) {
      const newView = resolveView(viewKey, viewContext)
      setActiveView(newView)
      resetTaskCounts()
    }
  }, [location, activeView.key, viewContext, resetTaskCounts])

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

  // Register keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when not editing text
      const target = document.activeElement
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable === 'true')
      ) {
        return
      }

      switch (event.key) {
        case 'n': {
          event.preventDefault()
          // Determine default project ID based on active view
          let defaultProjectId: string | undefined = undefined
          if (activeView.key.startsWith('project:')) {
            // Extract project ID from view key (format: "project:{id}")
            defaultProjectId = activeView.key.replace('project:', '')
          }
          openQuickAdd(defaultProjectId)
          break
        }
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault()
          handleArrowNavigation(1)
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault()
          handleArrowNavigation(-1)
          break
        case '?':
          if (event.shiftKey) {
            event.preventDefault()
            openShortcuts()
          }
          break
        case 's':
        case 'S':
          if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
            event.preventDefault()
            openSync()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleArrowNavigation, openShortcuts, openQuickAdd, openSync, activeView.key])

  const sidebarViewKey: ViewKey = activeView.key
  const isMultiListView = activeView.lists.length > 1

  // Get header slot content (registered by BaseListView for single-list views)
  const { slots } = useHeaderSlot()

  return (
    <>
      <Sidebar currentViewKey={sidebarViewKey} onViewChange={handleViewChange} />
      <SidebarInset className="overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="h-6 w-px bg-border" />
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
          <div className="h-6 w-px bg-border" />
          {activeView.metadata.icon && (
            <div className="text-muted-foreground">{activeView.metadata.icon}</div>
          )}
          <span className="text-lg font-medium">{activeView.metadata.title}</span>
          {totalTaskCount > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">
              {totalTaskCount}
            </Badge>
          )}
          {/* Header slot for view settings (registered by BaseListView for single-list views) */}
          {slots.get("view-settings")}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={openSync}
              title="Sync status"
            >
              <RefreshCw className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={openShortcuts}
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-5 w-5" />
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <ScrollArea className="h-[calc(100vh-4rem)]" data-task-scroll-container>
          <main className="space-y-6 p-6">
            {activeView.lists.map((list) => {
              // Render ProjectsListView for projects-type queries
              if (list.query.type === "projects") {
                return (
                  <ProjectsListView
                    key={list.id}
                    list={list}
                    onProjectCountChange={handleTaskCountChangeWithUpdate}
                    onProjectClick={handleTaskClick}
                    focusedProjectIndex={selection.listId === list.id ? selection.taskIndex : null}
                    isDismissed={dismissedLists.has(list.id)}
                    onDismiss={handleDismissList}
                    onRestore={handleRestoreList}
                    isMultiListView={isMultiListView}
                  />
                )
              }

              // Render RoutinesListView for routines-type queries
              if (list.query.type === "routines") {
                return (
                  <RoutinesListView
                    key={list.id}
                    list={list}
                    onRoutineCountChange={handleTaskCountChangeWithUpdate}
                    onRoutineClick={handleTaskClick}
                    focusedRoutineIndex={selection.listId === list.id ? selection.taskIndex : null}
                    isDismissed={dismissedLists.has(list.id)}
                    onDismiss={handleDismissList}
                    onRestore={handleRestoreList}
                    isMultiListView={isMultiListView}
                  />
                )
              }

              // Render TaskListView for all other query types
              return (
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
              )
            })}
          </main>
        </ScrollArea>
      </SidebarInset>
    </>
  )
}
