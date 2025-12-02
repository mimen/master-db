import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ClearRoutineTasksDialogProps {
  isOpen: boolean
  pendingTaskCount: number
  onConfirm: () => void
  onClose: () => void
  isClearing: boolean
}

export function ClearRoutineTasksDialog({
  isOpen,
  pendingTaskCount,
  onConfirm,
  onClose,
  isClearing,
}: ClearRoutineTasksDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isClearing) {
            e.preventDefault()
            onConfirm()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-orange-600" />
            </div>
            Clear All Pending Routine Tasks?
          </DialogTitle>
          <DialogDescription>
            This will delete all {pendingTaskCount} pending routine tasks from Todoist.
            Completed, missed, and skipped tasks will be preserved for historical tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
          <p className="text-sm font-medium text-orange-900">
            What will be deleted:
          </p>
          <ul className="text-xs text-orange-800 mt-2 space-y-1 list-disc list-inside">
            <li>{pendingTaskCount} pending routine tasks from Todoist</li>
            <li>All associated task records from the database</li>
          </ul>
          <p className="text-sm font-medium text-orange-900 mt-3">
            What will be preserved:
          </p>
          <ul className="text-xs text-orange-800 mt-2 space-y-1 list-disc list-inside">
            <li>All routine definitions and settings</li>
            <li>Completed, missed, and skipped task history</li>
            <li>Recalculated completion rates based on remaining history</li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isClearing}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isClearing}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {isClearing ? "Clearing..." : `Clear ${pendingTaskCount} Tasks`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
