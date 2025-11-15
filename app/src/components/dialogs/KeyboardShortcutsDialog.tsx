import { Keyboard } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import {
  getAllShortcutSections,
  isShortcutAvailable,
  type AppContextState,
  type ShortcutDefinition,
} from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

interface KeyboardShortcutsDialogProps {
  isOpen: boolean
  onClose: () => void
  contextState: AppContextState
}

export function KeyboardShortcutsDialog({ isOpen, onClose, contextState }: KeyboardShortcutsDialogProps) {
  // Get all shortcut sections (don't filter by context - show everything)
  const sections = useMemo(() => getAllShortcutSections(), [])

  // Helper to check if a shortcut is currently available
  const isAvailable = useCallback((shortcut: ShortcutDefinition) => {
    return isShortcutAvailable(shortcut, contextState)
  }, [contextState])

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
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Master your workflow with these shortcuts. Dimmed shortcuts require specific context (e.g., task selected).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sections.map((section) => (
            <div key={section.category}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.shortcuts.map((shortcut) => {
                  const available = isAvailable(shortcut)
                  return (
                    <div
                      key={shortcut.id}
                      className={cn(
                        "flex items-center justify-between gap-4 transition-opacity",
                        !available && "opacity-40"
                      )}
                    >
                      <span className="text-sm text-foreground">{shortcut.description}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {shortcut.keys.map((key, keyIndex) => (
                          <span key={keyIndex} className="inline-flex items-center gap-1">
                            <Kbd>{key}</Kbd>
                            {keyIndex < shortcut.keys.length - 1 && (
                              <span className="text-muted-foreground">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
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
