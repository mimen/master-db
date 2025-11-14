import { CheckCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { parseMarkdownLinks } from '@/lib/utils'
import type { TodoistTask } from '@/types/convex/todoist'

interface CompleteTaskDialogProps {
  task: TodoistTask | null
  onConfirm: () => void
  onClose: () => void
}

export function CompleteTaskDialog({ task, onConfirm, onClose }: CompleteTaskDialogProps) {
  if (!task) return null

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            onConfirm()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            Complete Task?
          </DialogTitle>
          <DialogDescription>
            Mark this task as completed. This action can be undone from your completed tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium text-gray-800">
            {parseMarkdownLinks(task.content).map((segment, index) => {
              if (segment.type === 'text') {
                return <span key={index}>{segment.content}</span>
              } else {
                return (
                  <a
                    key={index}
                    href={segment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {segment.content}
                  </a>
                )
              }
            })}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="bg-green-600 hover:bg-green-700" onClick={onConfirm}>
            Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
