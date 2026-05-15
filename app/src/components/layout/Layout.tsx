import { useQuery } from "convex/react"
import { Archive, Keyboard, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "wouter"

import { DashboardView } from "../DashboardView"
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
  const { openShortcuts, openQuickAdd, openSync, openArchive } = useDialogContext()
  const { getCountForView } = useCountRegistry()
  const [location, setLocation] = useLocation()

  // Initialize active view from URL (we'll update this in useEffect once viewContext loads)
  const [activeView, setActiveView] = useState<ViewSelection>(() => resolveView("view:inbox"))
  const [dismissedLists, setDismissedLists] = useState<Set<string>>(new Set())
  const [taskCountsAtDismissal, setTaskCountsAtDismissal] = useState<Map<string, number>>(new Map())

  // Track entities for each list (for cursor navigation)
  const entitiesRef = useRef<Map<string, unknown[]>>(new Map())

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

  // Compute current project for archive action (project views only)
  const currentProject = useMemo(() => {
    if (!activeView.key.startsWith("view:project:") || activeView.key.includes("-family")) {
      return null
    }
    const projectId = activeView.key.replace("view:project:", "")
    return projectsWithMetadata?.find(p => p.todoist_id === projectId) ?? null
  }, [activeView.key, projectsWithMetadata])

  const { updateTaskCount, resetTaskCounts, getTaskCounts } = useTaskCounts()

  const listIds = useMemo(() => activeView.lists.map((list) => list.id), [activeView.lists])

  // Callback for list views to report their entities
  const handleEntitiesChange = useCallback((listId: string, entities: unknown[]) => {
    entitiesRef.current.set(listId, entities)
  }, [])

  // Entity getter functions for cursor navigation
  const getEntitiesForList = useCallback((listId: string): Record<string, unknown>[] => {
    const entities = entitiesRef.current.get(listId) ?? []
    return entities as Record<string, unknown>[]
  }, [])

  const getEntityId = useCallback((entity: Record<string, unknown>) => {
    // Handle different entity types
    // Tasks and Projects both use todoist_id
    if ('todoist_id' in entity && typeof entity.todoist_id === 'string') return entity.todoist_id
    // Routines use _id
    if ('_id' in entity && typeof entity._id === 'string') return entity._id
    // Fallback
    const id = 'id' in entity ? entity.id : entity._id
    return String(id)
  }, [])

  const { selection, handleEntityRemoved, handleArrowNavigation, handleEntityClick } = useTaskSelection({
    listIds,
    getEntitiesForList,
    getEntityId,
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

  // DOM-based view navigation for Shift+Arrow keyboard shortcuts
  const handleViewNavigation = useCallback(
    (direction: 1 | -1) => {
      // 1. Query all visible sidebar items (excludes collapsed children)
      const sidebarItems = Array.from(
        document.querySelectorAll('[data-sidebar-view-item="true"]')
      ) as HTMLElement[]

      if (sidebarItems.length === 0) {
        console.warn("No navigable sidebar items found")
        return
      }

      // 2. Find currently active item
      // IMPORTANT: Use data-is-active to find the actual active element
      // (not just first match by view key, to handle duplicates correctly)
      const currentIndex = sidebarItems.findIndex(
        (item) => item.getAttribute('data-is-active') === 'true'
      )

      // 3. Calculate target index with wrap-around
      let targetIndex: number
      if (currentIndex === -1) {
        // Current view not in sidebar (edge case) - start from beginning or end
        targetIndex = direction === 1 ? 0 : sidebarItems.length - 1
      } else {
        // Wrap around: (current + direction + length) % length
        targetIndex = (currentIndex + direction + sidebarItems.length) % sidebarItems.length
      }

      // 4. Get target view key from DOM
      const targetElement = sidebarItems[targetIndex]
      const targetViewKey = targetElement.getAttribute('data-view-key') as ViewKey

      if (!targetViewKey) {
        console.error("Target element missing data-view-key")
        return
      }

      // 5. Resolve and navigate
      const targetView = resolveView(targetViewKey, viewContext)
      if (targetView) {
        handleViewChange(targetView)
      } else {
        console.error(`Failed to resolve view: ${targetViewKey}`)
      }
    },
    [activeView.key, viewContext, handleViewChange]
  )

  // Sync view when URL changes (browser back/forward, direct navigation)
  // Also handles initial load from URL
  // IMPORTANT: We must re-resolve when viewContext changes even if viewKey stays the same,
  // because dynamic views (like priority-projects) depend on context data to build lists
  useEffect(() => {
    const viewKey = pathToViewKey(location, viewContext)
    if (viewKey) {
      // Re-resolve if viewKey changed
      if (viewKey !== activeView.key) {
        const newView = resolveView(viewKey, viewContext)
        setActiveView(newView)
        resetTaskCounts()
        return
      }

      // Re-resolve if same viewKey but view has empty lists and context now has data
      // This handles the case where we initially loaded with empty context
      const needsContextData =
        viewKey.startsWith("view:priority-projects:") ||
        viewKey.startsWith("view:project:") ||
        viewKey.startsWith("view:project-family:")

      if (needsContextData && activeView.lists.length === 0 && viewContext.projectsWithMetadata) {
        const newView = resolveView(viewKey, viewContext)
        setActiveView(newView)
        resetTaskCounts()
      }
    }
  }, [location, activeView.key, activeView.lists.length, viewContext, resetTaskCounts])

  const handleTaskCountChangeWithUpdate = useCallback(
    (listId: string, count: number) => {
      updateTaskCount(listId, count)
      // Note: Cursor updates now happen via handleEntityRemoved, not count changes

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
    [updateTaskCount, dismissedLists, taskCountsAtDismissal]
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
        (target instanceof HTMLElement && target.isContentEditable)
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
          if (event.shiftKey) {
            handleViewNavigation(1)  // View navigation
          } else {
            handleArrowNavigation(1)  // Task navigation
          }
          break
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault()
          if (event.shiftKey) {
            handleViewNavigation(-1)  // View navigation
          } else {
            handleArrowNavigation(-1)  // Task navigation
          }
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
  }, [handleArrowNavigation, handleViewNavigation, openShortcuts, openQuickAdd, openSync, activeView.key])

  // Redirect to inbox when viewing an archived project
  useEffect(() => {
    if (!activeView.key.startsWith("view:project:") || activeView.key.includes("-family")) {
      return
    }
    const projectId = activeView.key.replace("view:project:", "")
    const project = projectsWithMetadata?.find(p => p.todoist_id === projectId)

    if (project?.is_archived) {
      const inboxView = resolveView("view:inbox")
      handleViewChange(inboxView)
    }
  }, [activeView.key, projectsWithMetadata, handleViewChange])

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
          {/* Archive button for project views (not for Inbox which can't be archived) */}
          {currentProject && !currentProject.is_archived && !currentProject.is_inbox_project && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openArchive(currentProject)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Archive className="h-4 w-4 mr-1.5" />
              Archive
            </Button>
          )}
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
              // Render DashboardView for the dashboard query type.
              // It manages its own data fetching via useQuery internally.
              if (list.query.type === "dashboard") {
                return <DashboardView key={list.id} listId={list.id} />
              }

              // Render ProjectsListView for projects-type queries
              if (list.query.type === "projects") {
                return (
                  <ProjectsListView
                    key={list.id}
                    list={list}
                    onProjectCountChange={handleTaskCountChangeWithUpdate}
                    onProjectClick={handleEntityClick}
                    focusedEntityId={selection.listId === list.id ? selection.entityId : null}
                    onEntityRemoved={handleEntityRemoved}
                    onEntitiesChange={handleEntitiesChange}
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
                    onRoutineClick={handleEntityClick}
                    focusedEntityId={selection.listId === list.id ? selection.entityId : null}
                    onEntityRemoved={handleEntityRemoved}
                    onEntitiesChange={handleEntitiesChange}
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
                  onTaskClick={handleEntityClick}
                  focusedEntityId={selection.listId === list.id ? selection.entityId : null}
                  onEntityRemoved={handleEntityRemoved}
                  onEntitiesChange={handleEntitiesChange}
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
