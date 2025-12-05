import { useQuery } from 'convex/react'
import { useMemo, useState } from 'react'

import { ArchiveProjectDialog } from './ArchiveProjectDialog'
import { CompleteTaskDialog } from './CompleteTaskDialog'
import { DeadlineDialog } from './DeadlineDialog'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { DueDateDialog } from './DueDateDialog'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { LabelDialog } from './LabelDialog'
import { MoveProjectConfirmationDialog } from './MoveProjectConfirmationDialog'
import { PriorityDialog } from './PriorityDialog'
import { ProjectDialog } from './ProjectDialog'
import { ProjectTypeDialog } from './ProjectTypeDialog'
import { QuickAddTaskDialog } from './QuickAddTaskDialog'
import { SettingsDialog } from './SettingsDialog'
import { SyncDialog } from './SyncDialog'

import { useDialogContext } from '@/contexts/DialogContext'
import { useFocusContext } from '@/contexts/FocusContext'
import { api } from '@/convex/_generated/api'
import { useOptimisticDeadlineChange } from '@/hooks/useOptimisticDeadlineChange'
import { useOptimisticDueChange } from '@/hooks/useOptimisticDueChange'
import { useOptimisticLabelChange } from '@/hooks/useOptimisticLabelChange'
import { useOptimisticPriorityChange } from '@/hooks/useOptimisticPriorityChange'
import { useOptimisticProjectMove } from '@/hooks/useOptimisticProjectMove'
import { useOptimisticProjectPriority } from '@/hooks/useOptimisticProjectPriority'
import { useOptimisticProjectType } from '@/hooks/useOptimisticProjectType'
import { useOptimisticRoutineLabels } from '@/hooks/useOptimisticRoutineLabels'
import { useOptimisticRoutinePriority } from '@/hooks/useOptimisticRoutinePriority'
import { useOptimisticRoutineProject } from '@/hooks/useOptimisticRoutineProject'
import { useOptimisticTaskComplete } from '@/hooks/useOptimisticTaskComplete'
import { useTodoistAction } from '@/hooks/useTodoistAction'
import { parseNaturalLanguageDate } from '@/lib/dateFormatters'
import type { ProjectType } from '@/lib/projectTypes'
import type { AppContextState } from '@/lib/shortcuts'

const EXPAND_NESTED_KEY = "sidebar:expandNested"

export function DialogManager() {
  const { currentTask, currentProject, currentRoutine, projectToMove, selectedParentProjectId, setSelectedParentProjectId, dialogType, isShortcutsOpen, isSettingsOpen, isQuickAddOpen, isSyncOpen, quickAddDefaultProjectId, closeDialog } = useDialogContext()
  const { focusedEntityType } = useFocusContext()
  const [isMovingProject, setIsMovingProject] = useState(false)
  const allProjects = useQuery(api.todoist.computed.queries.getProjectsWithMetadata.getProjectsWithMetadata)

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

  const updateTask = useTodoistAction(api.todoist.actions.updateTask.updateTask, {
    loadingMessage: "Updating task...",
    successMessage: "Task updated!",
    errorMessage: "Failed to update task"
  })

  const optimisticLabelChange = useOptimisticLabelChange()
  const optimisticPriorityChange = useOptimisticPriorityChange()
  const optimisticProjectMove = useOptimisticProjectMove()
  const optimisticProjectPriority = useOptimisticProjectPriority()
  const optimisticProjectType = useOptimisticProjectType()
  const optimisticRoutinePriority = useOptimisticRoutinePriority()
  const optimisticRoutineProject = useOptimisticRoutineProject()
  const optimisticRoutineLabels = useOptimisticRoutineLabels()
  const optimisticTaskComplete = useOptimisticTaskComplete()
  const optimisticDueChange = useOptimisticDueChange()
  const optimisticDeadlineChange = useOptimisticDeadlineChange()

  const deleteTask = useTodoistAction(api.todoist.actions.deleteTask.deleteTask, {
    loadingMessage: "Deleting task...",
    successMessage: "Task deleted!",
    errorMessage: "Failed to delete task"
  })

  const archiveProject = useTodoistAction(api.todoist.actions.archiveProject.archiveProject, {
    loadingMessage: "Archiving project...",
    successMessage: "Project archived!",
    errorMessage: "Failed to archive project"
  })

  const moveProject = useTodoistAction(api.todoist.actions.moveProject.moveProject, {
    loadingMessage: "Moving project...",
    successMessage: "Project moved!",
    errorMessage: "Failed to move project"
  })

  // Build context state for keyboard shortcuts
  const contextState: AppContextState = useMemo(() => ({
    hasTaskFocused: focusedEntityType === 'task',
    hasProjectFocused: focusedEntityType === 'project',
    hasDialogOpen: dialogType !== null || isQuickAddOpen || isSettingsOpen || isSyncOpen,
  }), [focusedEntityType, dialogType, isQuickAddOpen, isSettingsOpen, isSyncOpen])

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
    } else if (currentRoutine) {
      // Close dialog immediately for instant feedback
      closeDialog()

      // Use centralized optimistic priority change for routines
      optimisticRoutinePriority(currentRoutine._id, priority)
    }
  }

  const handleProjectSelect = async (projectId: string) => {
    if (currentTask) {
      // Close dialog immediately for instant feedback
      closeDialog()

      // Use centralized optimistic project move
      optimisticProjectMove(currentTask.todoist_id, projectId)
    } else if (currentRoutine) {
      // Close dialog immediately for instant feedback
      closeDialog()

      // Use centralized optimistic project change for routines
      optimisticRoutineProject(currentRoutine._id, projectId)
    }
  }

  const handleLabelSelect = async (labels: string[]) => {
    if (currentTask) {
      // Labels dialog doesn't auto-close, but run action with optimistic update
      optimisticLabelChange(currentTask.todoist_id, labels)
    } else if (currentRoutine) {
      // For routines, add back the "routine" label that's filtered from display
      const labelsWithRoutine = [...labels, "routine"]
      // Labels dialog doesn't auto-close, but run action with optimistic update
      optimisticRoutineLabels(currentRoutine._id, labelsWithRoutine)
    }
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

  const handleProjectTypeSelect = async (projectType: ProjectType | null) => {
    if (!currentProject) return

    // Close dialog immediately for instant feedback
    closeDialog()

    // Use centralized optimistic project type change
    optimisticProjectType(currentProject.todoist_id, projectType)
  }

  const handleMoveProjectParentSelect = (parentId: string) => {
    // Parent selector returned a parent ID (or empty string for top-level)
    setSelectedParentProjectId(parentId || null)
  }

  const handleMoveProjectConfirm = async () => {
    if (!projectToMove || selectedParentProjectId === undefined) return

    setIsMovingProject(true)

    try {
      // Call moveProject action with the selected parent
      // Use childOrder = 0 to put at the beginning of siblings
      // (or could be calculated based on existing children)
      moveProject({
        projectId: projectToMove.todoist_id,
        parentId: selectedParentProjectId,
        childOrder: 0
      })

      // Close the dialogs
      closeDialog()
    } finally {
      setIsMovingProject(false)
    }
  }

  // Get the selected parent project for the confirmation dialog
  const selectedParentProject = selectedParentProjectId
    ? allProjects?.find((p) => p.todoist_id === selectedParentProjectId) || null
    : null

  return (
    <>
      <PriorityDialog
        task={dialogType === 'priority' ? currentTask : null}
        project={dialogType === 'priority' ? currentProject : null}
        routine={dialogType === 'priority' ? currentRoutine : null}
        onSelect={handlePrioritySelect}
        onClose={closeDialog}
      />
      <ProjectDialog
        task={dialogType === 'project' ? currentTask : null}
        routine={dialogType === 'project' ? currentRoutine : null}
        projectToMove={dialogType === 'moveProject' ? projectToMove : null}
        onSelect={dialogType === 'moveProject' ? handleMoveProjectParentSelect : handleProjectSelect}
        onClose={closeDialog}
      />
      <MoveProjectConfirmationDialog
        project={dialogType === 'moveProject' && selectedParentProjectId !== null ? projectToMove : null}
        newParentProject={selectedParentProject}
        isMoving={isMovingProject}
        onConfirm={handleMoveProjectConfirm}
        onCancel={closeDialog}
      />
      <LabelDialog
        task={dialogType === 'label' ? currentTask : null}
        routine={dialogType === 'label' ? currentRoutine : null}
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
      <ProjectTypeDialog
        project={dialogType === 'projectType' ? currentProject : null}
        onSelect={handleProjectTypeSelect}
        onClose={closeDialog}
      />
      <KeyboardShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={closeDialog}
        contextState={contextState}
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
      <SyncDialog
        isOpen={isSyncOpen}
        onClose={closeDialog}
      />
    </>
  )
}
