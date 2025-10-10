import { Keyboard } from 'lucide-react'
import { useEffect, useRef } from 'react'

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
      { keys: ['?'], description: 'Show this help' },
    ]
  }
]

export function KeyboardShortcutsDialog({ isOpen, onClose }: KeyboardShortcutsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen) {
      dialog.showModal()
    } else {
      dialog.close()
    }

    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }

    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [isOpen, onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        e.stopPropagation()
      }

      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return (
    <dialog
      ref={dialogRef}
      className="backdrop:bg-black/75 bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-0"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose()
        }
      }}
    >
      <div className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
            <Keyboard className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Keyboard Shortcuts</h2>
            <p className="text-sm text-gray-600">Master your workflow with these shortcuts</p>
          </div>
        </div>

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

        <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            Close (ESC or Enter)
          </button>
        </div>
      </div>
    </dialog>
  )
}
