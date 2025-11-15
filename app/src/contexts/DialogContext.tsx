import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

import type { TodoistTask, TodoistProjectWithMetadata } from '@/types/convex/todoist'

export type DialogType = 'priority' | 'project' | 'label' | 'dueDate' | 'deadline' | 'complete' | 'delete' | 'archive' | 'shortcuts' | 'settings' | 'quickAdd' | 'sync'

interface DialogContextValue {
  currentTask: TodoistTask | null
  currentProject: TodoistProjectWithMetadata | null
  dialogType: DialogType | null
  isShortcutsOpen: boolean
  isSettingsOpen: boolean
  isQuickAddOpen: boolean
  isSyncOpen: boolean
  quickAddDefaultProjectId?: string
  openPriority: (item: TodoistTask | TodoistProjectWithMetadata) => void
  openProject: (task: TodoistTask) => void
  openLabel: (task: TodoistTask) => void
  openDueDate: (task: TodoistTask) => void
  openDeadline: (task: TodoistTask) => void
  openComplete: (task: TodoistTask) => void
  openDelete: (task: TodoistTask) => void
  openArchive: (project: TodoistProjectWithMetadata) => void
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
  const [dialogType, setDialogType] = useState<DialogType | null>(null)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [isSyncOpen, setIsSyncOpen] = useState(false)
  const [quickAddDefaultProjectId, setQuickAddDefaultProjectId] = useState<string | undefined>(undefined)

  const openPriority = useCallback((item: TodoistTask | TodoistProjectWithMetadata) => {
    // Check if it's a task or project by checking for task-specific fields
    if ('content' in item) {
      setCurrentTask(item as TodoistTask)
      setCurrentProject(null)
    } else {
      setCurrentProject(item as TodoistProjectWithMetadata)
      setCurrentTask(null)
    }
    setDialogType('priority')
  }, [])

  const openProject = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
    setDialogType('project')
  }, [])

  const openLabel = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
    setDialogType('label')
  }, [])

  const openDueDate = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
    setDialogType('dueDate')
  }, [])

  const openDeadline = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
    setDialogType('deadline')
  }, [])

  const openComplete = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
    setDialogType('complete')
  }, [])

  const openDelete = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
    setDialogType('delete')
  }, [])

  const openArchive = useCallback((project: TodoistProjectWithMetadata) => {
    setCurrentProject(project)
    setCurrentTask(null)
    setDialogType('archive')
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
    setDialogType(null)
    setIsShortcutsOpen(false)
    setIsSettingsOpen(false)
    setIsQuickAddOpen(false)
    setIsSyncOpen(false)
    setQuickAddDefaultProjectId(undefined)
  }, [])

  const value: DialogContextValue = {
    currentTask,
    currentProject,
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
