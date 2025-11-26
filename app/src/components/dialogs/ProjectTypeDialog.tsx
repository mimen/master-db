import { useEffect, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getProjectTypeDisplay } from '@/lib/projectTypes'
import { cn } from '@/lib/utils'
import type { ProjectType } from '@/lib/projectTypes'
import type { TodoistProjectWithMetadata } from '@/types/convex/todoist'

interface ProjectTypeDialogProps {
  project: TodoistProjectWithMetadata | null
  onSelect: (projectType: ProjectType | null) => void
  onClose: () => void
}

const projectTypes = [
  { value: 'area-of-responsibility' as const, label: 'Area', name: 'Ongoing Responsibility', shortcut: '1' },
  { value: 'project-type' as const, label: 'Project', name: 'Finite Work', shortcut: '2' },
  { value: null, label: 'None', name: 'Remove Type', shortcut: '3' },
]

export function ProjectTypeDialog({ project, onSelect, onClose }: ProjectTypeDialogProps) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const currentType = project?.metadata?.projectType

  useEffect(() => {
    if (project) {
      const index = projectTypes.findIndex(t => t.value === currentType)
      setFocusedIndex(index >= 0 ? index : 2) // Default to "None" if not found
    }
  }, [project, currentType])

  if (!project) return null

  return (
    <Dialog open={!!project} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={(e) => {
          switch (e.key) {
            case '1':
              e.preventDefault()
              onSelect('area-of-responsibility')
              break
            case '2':
              e.preventDefault()
              onSelect('project-type')
              break
            case '3':
              e.preventDefault()
              onSelect(null)
              break
            case 'ArrowUp':
            case 'ArrowLeft':
              e.preventDefault()
              setFocusedIndex(prev => Math.max(0, prev - 1))
              break
            case 'ArrowDown':
            case 'ArrowRight':
              e.preventDefault()
              setFocusedIndex(prev => Math.min(projectTypes.length - 1, prev + 1))
              break
            case 'Enter':
            case ' ':
              e.preventDefault()
              onSelect(projectTypes[focusedIndex].value)
              break
          }
        }}
      >
        <DialogHeader className="text-center">
          <DialogTitle className="text-2xl">Set Project Type</DialogTitle>
          <DialogDescription>
            Use arrow keys and Enter, or press 1-3
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          {projectTypes.map((type, index) => {
            const isSelected = currentType === type.value
            const isFocused = focusedIndex === index
            const typeDisplay = type.value ? getProjectTypeDisplay(type.value) : null
            const Icon = typeDisplay?.icon

            return (
              <button
                key={type.label}
                onClick={() => onSelect(type.value)}
                className={cn(
                  'p-6 rounded-xl border-2 font-bold text-lg transition-all duration-200 transform',
                  isSelected
                    ? 'bg-primary text-primary-foreground scale-105 shadow-lg border-primary'
                    : isFocused
                    ? 'bg-accent border-accent-foreground/20 scale-102 shadow-md'
                    : 'bg-muted/50 border-border hover:bg-accent hover:scale-102',
                  isFocused && 'ring-2 ring-primary ring-offset-2'
                )}
              >
                <div className="flex items-center justify-center mb-2">
                  {Icon ? (
                    <Icon size="lg" className="h-8 w-8" />
                  ) : (
                    <div className="h-8 w-8 rounded-full border-2 border-dashed border-current" />
                  )}
                </div>
                <div className="text-xl font-black mb-1">{type.label}</div>
                <div className="text-xs opacity-75">{type.name}</div>
                <div className="text-xs mt-2 opacity-60">Press {type.shortcut}</div>
              </button>
            )
          })}
        </div>

        <div className="mt-4 text-center text-sm text-muted-foreground">
          Current: <span className="font-semibold">
            {currentType ? getProjectTypeDisplay(currentType).label : 'Unassigned'}
          </span> • ESC to cancel
        </div>
      </DialogContent>
    </Dialog>
  )
}
