import { Archive } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TodoistProjectWithMetadata } from '@/types/convex/todoist'

interface ArchiveProjectDialogProps {
  project: TodoistProjectWithMetadata | null
  onConfirm: () => void
  onClose: () => void
}

export function ArchiveProjectDialog({ project, onConfirm, onClose }: ArchiveProjectDialogProps) {
  if (!project) return null

  return (
    <Dialog open={!!project} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onConfirm()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
              <Archive className="h-6 w-6 text-amber-600" />
            </div>
            Archive Project?
          </DialogTitle>
          <DialogDescription>
            This will archive the project and hide it from your active projects view. You can unarchive it later in Todoist.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium text-gray-800">
            {project.name}
          </p>
          {project.metadata?.description && (
            <p className="text-xs text-gray-600 mt-1">
              {project.metadata.description}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
