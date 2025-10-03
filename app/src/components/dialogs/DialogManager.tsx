import { useAction } from 'convex/react'

import { CompleteTaskDialog } from './CompleteTaskDialog'
import { DeadlineDialog } from './DeadlineDialog'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { DueDateDialog } from './DueDateDialog'
import { LabelDialog } from './LabelDialog'
import { PriorityDialog } from './PriorityDialog'
import { ProjectDialog } from './ProjectDialog'

import { useDialogContext } from '@/contexts/OverlayContext'
import { api } from '@/convex/_generated/api'

export function DialogManager() {
  const { currentTask, dialogType, closeDialog } = useDialogContext()
  const updateTask = useAction(api.todoist.publicActions.updateTask)
  const moveTask = useAction(api.todoist.publicActions.moveTask)
  const completeTask = useAction(api.todoist.publicActions.completeTask)
  const deleteTask = useAction(api.todoist.publicActions.deleteTask)

  const handlePrioritySelect = async (priority: number) => {
    if (!currentTask) return

    try {
      await updateTask({
        todoistId: currentTask.todoist_id,
        priority
      })
      closeDialog()
    } catch (error) {
      console.error('Failed to update priority:', error)
    }
  }

  const handleProjectSelect = async (projectId: string) => {
    if (!currentTask) return

    try {
      await moveTask({
        todoistId: currentTask.todoist_id,
        projectId
      })
      closeDialog()
    } catch (error) {
      console.error('Failed to update project:', error)
    }
  }

  const handleLabelSelect = async (labels: string[]) => {
    if (!currentTask) return

    try {
      await updateTask({
        todoistId: currentTask.todoist_id,
        labels
      })
    } catch (error) {
      console.error('Failed to update labels:', error)
    }
  }

  const handleDueDateSelect = async (dueString: string) => {
    if (!currentTask) return

    try {
      await updateTask({
        todoistId: currentTask.todoist_id,
        dueString
      })
      closeDialog()
    } catch (error) {
      console.error('Failed to update due date:', error)
    }
  }

  const handleDeadlineSelect = async (deadlineDate: string) => {
    if (!currentTask) return

    try {
      await updateTask({
        todoistId: currentTask.todoist_id,
        deadlineDate: deadlineDate === 'no date' ? null : deadlineDate,
        deadlineLang: deadlineDate === 'no date' ? null : 'en'
      })
      closeDialog()
    } catch (error) {
      console.error('Failed to update deadline:', error)
    }
  }

  const handleComplete = async () => {
    if (!currentTask) return

    try {
      await completeTask({
        todoistId: currentTask.todoist_id
      })
      closeDialog()
    } catch (error) {
      console.error('Failed to complete task:', error)
    }
  }

  const handleDelete = async () => {
    if (!currentTask) return

    try {
      await deleteTask({
        taskId: currentTask.todoist_id
      })
      closeDialog()
    } catch (error) {
      console.error('Failed to delete task:', error)
    }
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
    </>
  )
}
