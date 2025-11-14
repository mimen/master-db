import { useState } from 'react'

import { ArchiveProjectDialog } from './ArchiveProjectDialog'
import { CompleteTaskDialog } from './CompleteTaskDialog'
import { DeadlineDialog } from './DeadlineDialog'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { DueDateDialog } from './DueDateDialog'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { LabelDialog } from './LabelDialog'
import { PriorityDialog } from './PriorityDialog'
import { ProjectDialog } from './ProjectDialog'
import { QuickAddTaskDialog } from './QuickAddTaskDialog'
import { SettingsDialog } from './SettingsDialog'

import { useDialogContext } from '@/contexts/DialogContext'
import { api } from '@/convex/_generated/api'
import { useOptimisticDeadlineChange } from '@/hooks/useOptimisticDeadlineChange'
import { useOptimisticDueChange } from '@/hooks/useOptimisticDueChange'
import { useOptimisticLabelChange } from '@/hooks/useOptimisticLabelChange'
import { useOptimisticPriorityChange } from '@/hooks/useOptimisticPriorityChange'
import { useOptimisticProjectMove } from '@/hooks/useOptimisticProjectMove'
import { useOptimisticProjectPriority } from '@/hooks/useOptimisticProjectPriority'
import { useOptimisticTaskComplete } from '@/hooks/useOptimisticTaskComplete'
import { useTodoistAction } from '@/hooks/useTodoistAction'
import { parseNaturalLanguageDate } from '@/lib/dateFormatters'

const EXPAND_NESTED_KEY = "sidebar:expandNested"

export function DialogManager() {
  const { currentTask, currentProject, dialogType, isShortcutsOpen, isSettingsOpen, isQuickAddOpen, quickAddDefaultProjectId, closeDialog } = useDialogContext()

  // Manage expandNested state for settings dialog
  const [expandNested, setExpandNested] = useState<boolean>(() => {
    try {
      const item = window.localStorage.getItem(EXPAND_NESTED_KEY)
      return item ? JSON.parse(item) : false
    } catch {
      return false
    }
  })

  // Persist expandNested to localStorage
  const handleExpandNestedChange = (value: boolean) => {
    setExpandNested(value)
    try {
      window.localStorage.setItem(EXPAND_NESTED_KEY, JSON.stringify(value))
      // Trigger a storage event for other components to react
      window.dispatchEvent(new Event('storage'))
    } catch (error) {
      console.warn('Error saving expandNested setting:', error)
    }
  }

  const updateTask = useTodoistAction(api.todoist.publicActions.updateTask, {
    loadingMessage: "Updating task...",
    successMessage: "Task updated!",
    errorMessage: "Failed to update task"
  })

  const optimisticLabelChange = useOptimisticLabelChange()
  const optimisticPriorityChange = useOptimisticPriorityChange()
  const optimisticProjectMove = useOptimisticProjectMove()
  const optimisticProjectPriority = useOptimisticProjectPriority()
  const optimisticTaskComplete = useOptimisticTaskComplete()
  const optimisticDueChange = useOptimisticDueChange()
  const optimisticDeadlineChange = useOptimisticDeadlineChange()

  const deleteTask = useTodoistAction(api.todoist.publicActions.deleteTask, {
    loadingMessage: "Deleting task...",
    successMessage: "Task deleted!",
    errorMessage: "Failed to delete task"
  })

  const archiveProject = useTodoistAction(api.todoist.publicActions.archiveProject, {
    loadingMessage: "Archiving project...",
    successMessage: "Project archived!",
    errorMessage: "Failed to archive project"
  })

  const handlePrioritySelect = async (priority: number) => {
    if (currentTask) {
      // Close dialog immediately for instant feedback
      closeDialog()

      // Use centralized optimistic priority change for tasks
      optimisticPriorityChange(currentTask.todoist_id, priority)
    } else if (currentProject) {
      // Close dialog immediately for instant feedback
      closeDialog()

      // Use centralized optimistic priority change for projects
      optimisticProjectPriority(currentProject.todoist_id, priority)
    }
  }

  const handleProjectSelect = async (projectId: string) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Use centralized optimistic project move
    optimisticProjectMove(currentTask.todoist_id, projectId)
  }

  const handleLabelSelect = async (labels: string[]) => {
    if (!currentTask) return

    // Labels dialog doesn't auto-close, but run action with optimistic update
    optimisticLabelChange(currentTask.todoist_id, labels)
  }

  const handleDueDateSelect = async (dueString: string) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Parse dueString to get date for optimistic update
    let optimisticDue: { date: string; datetime?: string } | null = null

    if (dueString === 'no date') {
      optimisticDue = null
    } else {
      // Try to parse natural language date
      const parsedDate = parseNaturalLanguageDate(dueString)
      if (parsedDate) {
        optimisticDue = { date: parsedDate }
      }
    }

    // Use optimistic update if we could parse the date
    if (optimisticDue !== null || dueString === 'no date') {
      optimisticDueChange(currentTask.todoist_id, optimisticDue)
    } else {
      // Fallback to direct API call if we couldn't parse
      updateTask({
        todoistId: currentTask.todoist_id,
        dueString
      })
    }
  }

  const handleDeadlineSelect = async (deadlineDate: string) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Use optimistic update
    const optimisticDeadline = deadlineDate === 'no date' ? null : { date: deadlineDate }
    optimisticDeadlineChange(currentTask.todoist_id, optimisticDeadline)
  }

  const handleComplete = async () => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Use centralized optimistic task complete
    optimisticTaskComplete(currentTask.todoist_id)
  }

  const handleDelete = async () => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    deleteTask({
      taskId: currentTask.todoist_id
    })
  }

  const handleArchive = async () => {
    if (!currentProject) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    archiveProject({
      projectId: currentProject.todoist_id
    })
  }

  return (
    <>
      <PriorityDialog
        task={dialogType === 'priority' ? currentTask : null}
        project={dialogType === 'priority' ? currentProject : null}
        onSelect={handlePrioritySelect}
        onClose={closeDialog}
      />
      <ProjectDialog
        task={dialogType === 'project' ? currentTask : null}
        onSelect={handleProjectSelect}
        onClose={closeDialog}
      />
      <LabelDialog
        task={dialogType === 'label' ? currentTask : null}
        onSelect={handleLabelSelect}
        onClose={closeDialog}
      />
      <DueDateDialog
        task={dialogType === 'dueDate' ? currentTask : null}
        onSelect={handleDueDateSelect}
        onClose={closeDialog}
      />
      <DeadlineDialog
        task={dialogType === 'deadline' ? currentTask : null}
        onSelect={handleDeadlineSelect}
        onClose={closeDialog}
      />
      <CompleteTaskDialog
        task={dialogType === 'complete' ? currentTask : null}
        onConfirm={handleComplete}
        onClose={closeDialog}
      />
      <DeleteTaskDialog
        task={dialogType === 'delete' ? currentTask : null}
        onConfirm={handleDelete}
        onClose={closeDialog}
      />
      <ArchiveProjectDialog
        project={dialogType === 'archive' ? currentProject : null}
        onConfirm={handleArchive}
        onClose={closeDialog}
      />
      <KeyboardShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={closeDialog}
      />
      <SettingsDialog
        open={isSettingsOpen}
        onClose={closeDialog}
        expandNested={expandNested}
        onExpandNestedChange={handleExpandNestedChange}
      />
      <QuickAddTaskDialog
        isOpen={isQuickAddOpen}
        onClose={closeDialog}
        defaultProjectId={quickAddDefaultProjectId}
      />
    </>
  )
}
