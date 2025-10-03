import { useAction } from 'convex/react'

import { LabelDialog } from './LabelDialog'
import { PriorityDialog } from './PriorityDialog'
import { ProjectDialog } from './ProjectDialog'
import { api } from '@/convex/_generated/api'
import { useDialogContext } from '@/contexts/OverlayContext'

export function DialogManager() {
  const { currentTask, dialogType, closeDialog } = useDialogContext()
  const updateTask = useAction(api.todoist.publicActions.updateTask)
  const moveTask = useAction(api.todoist.publicActions.moveTask)

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
    </>
  )
}
