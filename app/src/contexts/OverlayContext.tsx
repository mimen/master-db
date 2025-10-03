import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

import type { TodoistTask } from '@/types/convex/todoist'

export type DialogType = 'priority' | 'project' | 'label' | 'dueDate' | 'deadline' | 'complete' | 'delete'

interface DialogContextValue {
  currentTask: TodoistTask | null
  dialogType: DialogType | null
  openPriority: (task: TodoistTask) => void
  openProject: (task: TodoistTask) => void
  openLabel: (task: TodoistTask) => void
  openDueDate: (task: TodoistTask) => void
  openDeadline: (task: TodoistTask) => void
  openComplete: (task: TodoistTask) => void
  openDelete: (task: TodoistTask) => void
  closeDialog: () => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [currentTask, setCurrentTask] = useState<TodoistTask | null>(null)
  const [dialogType, setDialogType] = useState<DialogType | null>(null)

  const openPriority = useCallback((task: TodoistTask) => {
    setCurrentTask(task)
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

  const closeDialog = useCallback(() => {
    setCurrentTask(null)
    setDialogType(null)
  }, [])

  const value: DialogContextValue = {
    currentTask,
    dialogType,
    openPriority,
    openProject,
    openLabel,
    openDueDate,
    openDeadline,
    openComplete,
    openDelete,
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
