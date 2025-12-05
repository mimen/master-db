import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

import type { Doc } from '@/convex/_generated/dataModel'
import type { TodoistTask, TodoistProjectWithMetadata } from '@/types/convex/todoist'

export type DialogType = 'priority' | 'project' | 'label' | 'dueDate' | 'deadline' | 'complete' | 'delete' | 'archive' | 'shortcuts' | 'settings' | 'quickAdd' | 'sync' | 'moveProject' | 'projectType'

interface DialogContextValue {
  currentTask: TodoistTask | null
  currentProject: TodoistProjectWithMetadata | null
  currentRoutine: Doc<"routines"> | null
  projectToMove: TodoistProjectWithMetadata | null
  selectedParentProjectId: string | null
  dialogType: DialogType | null
  isShortcutsOpen: boolean
  isSettingsOpen: boolean
  isQuickAddOpen: boolean
  isSyncOpen: boolean
  quickAddDefaultProjectId?: string
  openPriority: (item: TodoistTask | TodoistProjectWithMetadata | Doc<"routines">) => void
  openProject: (item: TodoistTask | Doc<"routines">) => void
  openLabel: (item: TodoistTask | Doc<"routines">) => void
  openDueDate: (task: TodoistTask) => void
  openDeadline: (task: TodoistTask) => void
  openComplete: (task: TodoistTask) => void
  openDelete: (task: TodoistTask) => void
  openArchive: (project: TodoistProjectWithMetadata) => void
  openMoveProject: (project: TodoistProjectWithMetadata) => void
  openProjectType: (project: TodoistProjectWithMetadata) => void
  setSelectedParentProjectId: (parentId: string | null) => void
  openShortcuts: () => void
  openSettings: () => void
  openQuickAdd: (defaultProjectId?: string) => void
  openSync: () => void
  closeDialog: () => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [currentTask, setCurrentTask] = useState<TodoistTask | null>(null)
  const [currentProject, setCurrentProject] = useState<TodoistProjectWithMetadata | null>(null)
  const [currentRoutine, setCurrentRoutine] = useState<Doc<"routines"> | null>(null)
  const [projectToMove, setProjectToMove] = useState<TodoistProjectWithMetadata | null>(null)
  const [selectedParentProjectId, setSelectedParentProjectId] = useState<string | null>(null)
  const [dialogType, setDialogType] = useState<DialogType | null>(null)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [isSyncOpen, setIsSyncOpen] = useState(false)
  const [quickAddDefaultProjectId, setQuickAddDefaultProjectId] = useState<string | undefined>(undefined)

  // Store the focused entity before opening a dialog for restoration after closing
  const [focusRestoreTarget, setFocusRestoreTarget] = useState<string | null>(null)

  // Helper to capture currently focused element before opening dialog
  const captureFocusedElement = useCallback(() => {
    const activeElement = document.activeElement as HTMLElement | null
    const entityId = activeElement?.getAttribute('data-entity-id')
    if (entityId) {
      setFocusRestoreTarget(entityId)
    }
  }, [])

  const openPriority = useCallback((item: TodoistTask | TodoistProjectWithMetadata | Doc<"routines">) => {
    captureFocusedElement()

    // Check if it's a task, project, or routine by checking for specific fields
    if ('content' in item) {
      // Task
      setCurrentTask(item as TodoistTask)
      setCurrentProject(null)
      setCurrentRoutine(null)
    } else if ('frequency' in item) {
      // Routine
      setCurrentRoutine(item as Doc<"routines">)
      setCurrentTask(null)
      setCurrentProject(null)
    } else {
      // Project
      setCurrentProject(item as TodoistProjectWithMetadata)
      setCurrentTask(null)
      setCurrentRoutine(null)
    }
    setDialogType('priority')
  }, [captureFocusedElement])

  const openProject = useCallback((item: TodoistTask | Doc<"routines">) => {
    captureFocusedElement()

    if ('content' in item) {
      // Task
      setCurrentTask(item as TodoistTask)
      setCurrentRoutine(null)
    } else {
      // Routine
      setCurrentRoutine(item as Doc<"routines">)
      setCurrentTask(null)
    }
    setCurrentProject(null)
    setDialogType('project')
  }, [captureFocusedElement])

  const openLabel = useCallback((item: TodoistTask | Doc<"routines">) => {
    captureFocusedElement()

    if ('content' in item) {
      // Task
      setCurrentTask(item as TodoistTask)
      setCurrentRoutine(null)
    } else {
      // Routine
      setCurrentRoutine(item as Doc<"routines">)
      setCurrentTask(null)
    }
    setCurrentProject(null)
    setDialogType('label')
  }, [captureFocusedElement])

  const openDueDate = useCallback((task: TodoistTask) => {
    captureFocusedElement()
    setCurrentTask(task)
    setDialogType('dueDate')
  }, [captureFocusedElement])

  const openDeadline = useCallback((task: TodoistTask) => {
    captureFocusedElement()
    setCurrentTask(task)
    setDialogType('deadline')
  }, [captureFocusedElement])

  const openComplete = useCallback((task: TodoistTask) => {
    captureFocusedElement()
    setCurrentTask(task)
    setDialogType('complete')
  }, [captureFocusedElement])

  const openDelete = useCallback((task: TodoistTask) => {
    captureFocusedElement()
    setCurrentTask(task)
    setDialogType('delete')
  }, [captureFocusedElement])

  const openArchive = useCallback((project: TodoistProjectWithMetadata) => {
    captureFocusedElement()
    setCurrentProject(project)
    setCurrentTask(null)
    setDialogType('archive')
  }, [captureFocusedElement])

  const openMoveProject = useCallback((project: TodoistProjectWithMetadata) => {
    captureFocusedElement()
    setProjectToMove(project)
    setSelectedParentProjectId(null)
    setDialogType('moveProject')
  }, [captureFocusedElement])

  const openProjectType = useCallback((project: TodoistProjectWithMetadata) => {
    captureFocusedElement()
    setCurrentProject(project)
    setCurrentTask(null)
    setDialogType('projectType')
  }, [captureFocusedElement])

  const handleSetSelectedParentProjectId = useCallback((parentId: string | null) => {
    setSelectedParentProjectId(parentId)
  }, [])

  const openShortcuts = useCallback(() => {
    setIsShortcutsOpen(true)
    setDialogType('shortcuts')
  }, [])

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true)
    setDialogType('settings')
  }, [])

  const openQuickAdd = useCallback((defaultProjectId?: string) => {
    setIsQuickAddOpen(true)
    setQuickAddDefaultProjectId(defaultProjectId)
    setDialogType('quickAdd')
  }, [])

  const openSync = useCallback(() => {
    setIsSyncOpen(true)
    setDialogType('sync')
  }, [])

  const closeDialog = useCallback(() => {
    setCurrentTask(null)
    setCurrentProject(null)
    setCurrentRoutine(null)
    setProjectToMove(null)
    setSelectedParentProjectId(null)
    setDialogType(null)
    setIsShortcutsOpen(false)
    setIsSettingsOpen(false)
    setIsQuickAddOpen(false)
    setIsSyncOpen(false)
    setQuickAddDefaultProjectId(undefined)

    // Restore focus to the previously focused element
    if (focusRestoreTarget) {
      // Use setTimeout to ensure dialog is fully closed before restoring focus
      setTimeout(() => {
        const element = document.querySelector(
          `[data-entity-id="${focusRestoreTarget}"]`
        ) as HTMLElement | null

        if (element) {
          element.focus()
        }
      }, 0)
      setFocusRestoreTarget(null)
    }
  }, [focusRestoreTarget])

  const value: DialogContextValue = {
    currentTask,
    currentProject,
    currentRoutine,
    projectToMove,
    selectedParentProjectId,
    dialogType,
    isShortcutsOpen,
    isSettingsOpen,
    isQuickAddOpen,
    isSyncOpen,
    quickAddDefaultProjectId,
    openPriority,
    openProject,
    openLabel,
    openDueDate,
    openDeadline,
    openComplete,
    openDelete,
    openArchive,
    openMoveProject,
    openProjectType,
    setSelectedParentProjectId: handleSetSelectedParentProjectId,
    openShortcuts,
    openSettings,
    openQuickAdd,
    openSync,
    closeDialog
  }

  return (
    <DialogContext.Provider value={value}>
      {children}
    </DialogContext.Provider>
  )
}

export function useDialogContext() {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error('useDialogContext must be used within a DialogProvider')
  }
  return context
}
