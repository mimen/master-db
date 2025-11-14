import { createContext, useContext, useState, type ReactNode } from "react"

export type OptimisticTaskUpdate =
  | {
      taskId: string
      type: "project-move"
      newProjectId: string
      timestamp: number
    }
  | {
      taskId: string
      type: "priority-change"
      newPriority: number
      timestamp: number
    }
  | {
      taskId: string
      type: "task-complete"
      timestamp: number
    }
  | {
      taskId: string
      type: "label-change"
      newLabels: string[]
      timestamp: number
    }
  | {
      taskId: string
      type: "due-change"
      newDue: { date: string; datetime?: string } | null
      timestamp: number
    }
  | {
      taskId: string
      type: "deadline-change"
      newDeadline: { date: string } | null
      timestamp: number
    }

interface OptimisticUpdatesContextValue {
  pendingUpdates: Map<string, OptimisticTaskUpdate>
  addUpdate: (update: OptimisticTaskUpdate) => void
  removeUpdate: (taskId: string) => void
  getUpdate: (taskId: string) => OptimisticTaskUpdate | undefined
}

const OptimisticUpdatesContext = createContext<OptimisticUpdatesContextValue | null>(null)

export function OptimisticUpdatesProvider({ children }: { children: ReactNode }) {
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, OptimisticTaskUpdate>>(
    new Map()
  )

  const addUpdate = (update: OptimisticTaskUpdate) => {
    setPendingUpdates((prev) => {
      const next = new Map(prev)
      next.set(update.taskId, update)
      return next
    })
  }

  const removeUpdate = (taskId: string) => {
    setPendingUpdates((prev) => {
      const next = new Map(prev)
      next.delete(taskId)
      return next
    })
  }

  const getUpdate = (taskId: string): OptimisticTaskUpdate | undefined => {
    return pendingUpdates.get(taskId)
  }

  return (
    <OptimisticUpdatesContext.Provider
      value={{ pendingUpdates, addUpdate, removeUpdate, getUpdate }}
    >
      {children}
    </OptimisticUpdatesContext.Provider>
  )
}

export function useOptimisticUpdates() {
  const context = useContext(OptimisticUpdatesContext)
  if (!context) {
    throw new Error("useOptimisticUpdates must be used within OptimisticUpdatesProvider")
  }
  return context
}
