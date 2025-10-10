import { useEffect } from 'react'

interface GlobalShortcutsConfig {
  onNavigateNext: () => void
  onNavigatePrevious: () => void
  onShowHelp: () => void
}

/**
 * Global keyboard shortcuts that work anywhere in the app.
 * These shortcuts fire regardless of what entity is focused.
 */
export function useGlobalShortcuts({
  onNavigateNext,
  onNavigatePrevious,
  onShowHelp,
}: GlobalShortcutsConfig) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent Tab from doing anything (we might use it later)
      if (event.key === 'Tab') {
        event.preventDefault()
        return
      }

      // Don't interfere with typing in input fields
      const target = event.target as HTMLElement | null
      const isEditable = target?.isContentEditable
      const tagName = target?.tagName
      const isTextInput =
        tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || isEditable

      if (isTextInput) return

      // Global shortcuts
      switch (event.key) {
        // Help dialog (Shift+?)
        case '?':
          if (event.shiftKey) {
            event.preventDefault()
            onShowHelp()
          }
          break

        // Navigation: Next task/view
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault()
          onNavigateNext()
          break

        // Navigation: Previous task/view
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault()
          onNavigatePrevious()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNavigateNext, onNavigatePrevious, onShowHelp])
}
