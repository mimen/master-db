import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'

import { ProjectColorIndicator } from '@/components/ProjectColorIndicator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getProjectColor } from '@/lib/colors'
import type { TodoistProjectWithMetadata } from '@/types/convex/todoist'

interface MoveProjectConfirmationDialogProps {
  project: TodoistProjectWithMetadata | null
  newParentProject: TodoistProjectWithMetadata | null
  isMoving?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const MoveProjectConfirmationDialog: FC<MoveProjectConfirmationDialogProps> = ({
  project,
  newParentProject,
  isMoving = false,
  onConfirm,
  onCancel,
}) => {
  const isOpen = !!project

  if (!project) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move Project</DialogTitle>
          <DialogDescription>
            Confirm moving this project to a new parent
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current project */}
          <div className="flex items-center gap-2">
            <ProjectColorIndicator project={project} size="md" />
            <span className="font-medium flex-1 truncate">{project.name}</span>
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ChevronRight className="h-4 w-4 text-muted-foreground rotate-90" />
          </div>

          {/* New parent project */}
          <div className="flex items-center gap-2">
            {newParentProject ? (
              <>
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: getProjectColor(newParentProject.color) }}
                />
                <span className="font-medium flex-1 truncate">{newParentProject.name}</span>
              </>
            ) : (
              <span className="font-medium text-muted-foreground flex-1">Top-level (no parent)</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={isMoving}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isMoving}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isMoving ? 'Moving...' : 'Move Project'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
