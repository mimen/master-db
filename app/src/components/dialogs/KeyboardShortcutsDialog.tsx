import { Keyboard } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface KeyboardShortcutsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface ShortcutSection {
  title: string
  shortcuts: Array<{
    keys: string[]
    description: string
  }>
}

const shortcuts: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['↑', '←'], description: 'Previous task or view' },
      { keys: ['↓', '→'], description: 'Next task or view' },
    ]
  },
  {
    title: 'Task Actions',
    shortcuts: [
      { keys: ['p'], description: 'Set priority' },
      { keys: ['#'], description: 'Move to project' },
      { keys: ['@'], description: 'Add labels' },
      { keys: ['s'], description: 'Schedule (due date)' },
      { keys: ['Shift', 'D'], description: 'Set deadline' },
      { keys: ['c'], description: 'Complete task' },
      { keys: ['Delete'], description: 'Delete task' },
    ]
  },
  {
    title: 'Dialog Controls',
    shortcuts: [
      { keys: ['Enter'], description: 'Confirm action' },
      { keys: ['ESC'], description: 'Cancel / Close dialog' },
      { keys: ['↑', '↓'], description: 'Navigate options' },
      { keys: ['1', '2', '3', '4'], description: 'Quick select priority' },
    ]
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['n'], description: 'Quick add task' },
      { keys: ['?'], description: 'Show this help' },
    ]
  }
]

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <Keyboard className="h-6 w-6 text-blue-600" />
            </div>
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Master your workflow with these shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {shortcuts.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.shortcuts.map((shortcut, index) => (
                  <div key={index} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-gray-600">{shortcut.description}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {shortcut.keys.map((key, keyIndex) => (
                        <span key={keyIndex} className="inline-flex items-center gap-1">
                          <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded shadow-sm min-w-[2rem] text-center">
                            {key}
                          </kbd>
                          {keyIndex < shortcut.keys.length - 1 && (
                            <span className="text-gray-400">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
