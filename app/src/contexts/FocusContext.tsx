/**
 * Focus Context
 *
 * Tracks which task or project is currently focused/selected in the UI.
 * This is used to enable context-aware keyboard shortcuts.
 */

import type { ReactNode } from 'react'
import { createContext, useContext, useState } from 'react'

import type { TodoistProjectWithMetadata, TodoistTask } from '@/types/convex/todoist'

interface FocusContextValue {
  focusedTask: TodoistTask | null
  focusedProject: TodoistProjectWithMetadata | null
  setFocusedTask: (task: TodoistTask | null) => void
  setFocusedProject: (project: TodoistProjectWithMetadata | null) => void
}

const FocusContext = createContext<FocusContextValue | undefined>(undefined)

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedTask, setFocusedTask] = useState<TodoistTask | null>(null)
  const [focusedProject, setFocusedProject] = useState<TodoistProjectWithMetadata | null>(null)

  return (
    <FocusContext.Provider
      value={{
        focusedTask,
        focusedProject,
        setFocusedTask,
        setFocusedProject,
      }}
    >
      {children}
    </FocusContext.Provider>
  )
}

export function useFocusContext() {
  const context = useContext(FocusContext)
  if (!context) {
    throw new Error('useFocusContext must be used within FocusProvider')
  }
  return context
}
