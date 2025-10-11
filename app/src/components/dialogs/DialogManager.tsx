import { CompleteTaskDialog } from './CompleteTaskDialog'
import { DeadlineDialog } from './DeadlineDialog'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { DueDateDialog } from './DueDateDialog'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { LabelDialog } from './LabelDialog'
import { PriorityDialog } from './PriorityDialog'
import { ProjectDialog } from './ProjectDialog'

import { useDialogContext } from '@/contexts/DialogContext'
import { api } from '@/convex/_generated/api'
import { useTodoistAction } from '@/hooks/useTodoistAction'

export function DialogManager() {
  const { currentTask, dialogType, isShortcutsOpen, closeDialog } = useDialogContext()

  const updateTask = useTodoistAction(api.todoist.publicActions.updateTask, {
    loadingMessage: "Updating task...",
    successMessage: "Task updated!",
    errorMessage: "Failed to update task"
  })

  const moveTask = useTodoistAction(api.todoist.publicActions.moveTask, {
    loadingMessage: "Moving task...",
    successMessage: "Task moved!",
    errorMessage: "Failed to move task"
  })

  const completeTask = useTodoistAction(api.todoist.publicActions.completeTask, {
    loadingMessage: "Completing task...",
    successMessage: "Task completed!",
    errorMessage: "Failed to complete task"
  })

  const deleteTask = useTodoistAction(api.todoist.publicActions.deleteTask, {
    loadingMessage: "Deleting task...",
    successMessage: "Task deleted!",
    errorMessage: "Failed to delete task"
  })

  const handlePrioritySelect = async (priority: number) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    updateTask({
      todoistId: currentTask.todoist_id,
      priority
    })
  }

  const handleProjectSelect = async (projectId: string) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    moveTask({
      todoistId: currentTask.todoist_id,
      projectId
    })
  }

  const handleLabelSelect = async (labels: string[]) => {
    if (!currentTask) return

    // Labels dialog doesn't auto-close, but run action immediately
    updateTask({
      todoistId: currentTask.todoist_id,
      labels
    })
  }

  const handleDueDateSelect = async (dueString: string) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    updateTask({
      todoistId: currentTask.todoist_id,
      dueString
    })
  }

  const handleDeadlineSelect = async (deadlineDate: string) => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    updateTask({
      todoistId: currentTask.todoist_id,
      deadlineDate: deadlineDate === 'no date' ? null : deadlineDate,
      deadlineLang: deadlineDate === 'no date' ? null : 'en'
    })
  }

  const handleComplete = async () => {
    if (!currentTask) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Run action in background
    completeTask({
      todoistId: currentTask.todoist_id
    })
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

  return (
    <>
      <PriorityDialog
        task={dialogType === 'priority' ? currentTask : null}
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
      <KeyboardShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={closeDialog}
      />
    </>
  )
}
