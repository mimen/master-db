import { createContext, useContext, useState, type ReactNode } from "react"

// ============================================
// TASK UPDATES
// ============================================

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
  | {
      taskId: string
      type: "text-change"
      newContent?: string
      newDescription?: string
      timestamp: number
    }

// ============================================
// PROJECT UPDATES
// ============================================

export type OptimisticProjectUpdate =
  | {
      projectId: string
      type: "text-change"
      newName?: string
      newDescription?: string
      timestamp: number
    }
  | {
      projectId: string
      type: "priority-change"
      newPriority: number
      timestamp: number
    }

// ============================================
// ROUTINE UPDATES
// ============================================

export type OptimisticRoutineUpdate =
  | {
      routineId: string
      type: "text-change"
      newName?: string
      newDescription?: string
      timestamp: number
    }
  | {
      routineId: string
      type: "priority-change"
      newPriority: number
      timestamp: number
    }
  | {
      routineId: string
      type: "project-change"
      newProjectId: string | undefined
      timestamp: number
    }
  | {
      routineId: string
      type: "label-change"
      newLabels: string[]
      timestamp: number
    }

// ============================================
// COMBINED TYPE
// ============================================

export type OptimisticUpdate = OptimisticTaskUpdate | OptimisticProjectUpdate | OptimisticRoutineUpdate

interface OptimisticUpdatesContextValue {
  // Task updates
  taskUpdates: Map<string, OptimisticTaskUpdate>
  addTaskUpdate: (update: OptimisticTaskUpdate) => void
  removeTaskUpdate: (taskId: string) => void
  getTaskUpdate: (taskId: string) => OptimisticTaskUpdate | undefined

  // Project updates
  projectUpdates: Map<string, OptimisticProjectUpdate>
  addProjectUpdate: (update: OptimisticProjectUpdate) => void
  removeProjectUpdate: (projectId: string) => void
  getProjectUpdate: (projectId: string) => OptimisticProjectUpdate | undefined

  // Routine updates
  routineUpdates: Map<string, OptimisticRoutineUpdate>
  addRoutineUpdate: (update: OptimisticRoutineUpdate) => void
  removeRoutineUpdate: (routineId: string) => void
  getRoutineUpdate: (routineId: string) => OptimisticRoutineUpdate | undefined

  // Legacy compatibility (deprecated - use task-specific methods)
  /** @deprecated Use taskUpdates instead */
  pendingUpdates: Map<string, OptimisticTaskUpdate>
  /** @deprecated Use addTaskUpdate instead */
  addUpdate: (update: OptimisticTaskUpdate) => void
  /** @deprecated Use removeTaskUpdate instead */
  removeUpdate: (taskId: string) => void
  /** @deprecated Use getTaskUpdate instead */
  getUpdate: (taskId: string) => OptimisticTaskUpdate | undefined
}

const OptimisticUpdatesContext = createContext<OptimisticUpdatesContextValue | null>(null)

export function OptimisticUpdatesProvider({ children }: { children: ReactNode }) {
  const [taskUpdates, setTaskUpdates] = useState<Map<string, OptimisticTaskUpdate>>(new Map())
  const [projectUpdates, setProjectUpdates] = useState<Map<string, OptimisticProjectUpdate>>(
    new Map()
  )
  const [routineUpdates, setRoutineUpdates] = useState<Map<string, OptimisticRoutineUpdate>>(
    new Map()
  )

  // Task update methods
  const addTaskUpdate = (update: OptimisticTaskUpdate) => {
    setTaskUpdates((prev) => {
      const next = new Map(prev)
      const existing = next.get(update.taskId)

      // Merge text-change updates to support simultaneous content + description changes
      if (existing?.type === "text-change" && update.type === "text-change") {
        next.set(update.taskId, {
          ...existing,
          ...update,
          // Preserve existing fields not in new update
          newContent: update.newContent ?? existing.newContent,
          newDescription: update.newDescription ?? existing.newDescription,
          timestamp: update.timestamp
        })
      } else {
        next.set(update.taskId, update)
      }

      return next
    })
  }

  const removeTaskUpdate = (taskId: string) => {
    setTaskUpdates((prev) => {
      const next = new Map(prev)
      next.delete(taskId)
      return next
    })
  }

  const getTaskUpdate = (taskId: string): OptimisticTaskUpdate | undefined => {
    return taskUpdates.get(taskId)
  }

  // Project update methods
  const addProjectUpdate = (update: OptimisticProjectUpdate) => {
    setProjectUpdates((prev) => {
      const next = new Map(prev)
      const existing = next.get(update.projectId)

      // Merge text-change updates to support simultaneous name + description changes
      if (existing?.type === "text-change" && update.type === "text-change") {
        next.set(update.projectId, {
          ...existing,
          ...update,
          // Preserve existing fields not in new update
          newName: update.newName ?? existing.newName,
          newDescription: update.newDescription ?? existing.newDescription,
          timestamp: update.timestamp
        })
      } else {
        next.set(update.projectId, update)
      }

      return next
    })
  }

  const removeProjectUpdate = (projectId: string) => {
    setProjectUpdates((prev) => {
      const next = new Map(prev)
      next.delete(projectId)
      return next
    })
  }

  const getProjectUpdate = (projectId: string): OptimisticProjectUpdate | undefined => {
    return projectUpdates.get(projectId)
  }

  // Routine update methods
  const addRoutineUpdate = (update: OptimisticRoutineUpdate) => {
    setRoutineUpdates((prev) => {
      const next = new Map(prev)
      next.set(update.routineId, update)
      return next
    })
  }

  const removeRoutineUpdate = (routineId: string) => {
    setRoutineUpdates((prev) => {
      const next = new Map(prev)
      next.delete(routineId)
      return next
    })
  }

  const getRoutineUpdate = (routineId: string): OptimisticRoutineUpdate | undefined => {
    return routineUpdates.get(routineId)
  }

  return (
    <OptimisticUpdatesContext.Provider
      value={{
        // Task updates
        taskUpdates,
        addTaskUpdate,
        removeTaskUpdate,
        getTaskUpdate,
        // Project updates
        projectUpdates,
        addProjectUpdate,
        removeProjectUpdate,
        getProjectUpdate,
        // Routine updates
        routineUpdates,
        addRoutineUpdate,
        removeRoutineUpdate,
        getRoutineUpdate,
        // Legacy compatibility (point to task methods)
        pendingUpdates: taskUpdates,
        addUpdate: addTaskUpdate,
        removeUpdate: removeTaskUpdate,
        getUpdate: getTaskUpdate
      }}
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
