import { useEffect, useContext } from 'react'

import { GlobalHotkeysContext } from '@/contexts/GlobalHotkeysContext'

export function useDialogHotkeyScope(isOpen: boolean, scopeId: string = 'dialog') {
  const hotkeys = useContext(GlobalHotkeysContext)
  useEffect(() => {
    if (!hotkeys || !isOpen) return
    // Register a dialog scope with empty handlers to block all shortcuts
    const unregister = hotkeys.registerScope({
      id: scopeId,
      handlers: {
        // Specifically block Enter to prevent task edit shortcuts
        'Enter': () => true,
        'shift+Enter': () => true,
        // Catch-all handler that prevents any shortcuts from propagating
        '*': (event: KeyboardEvent) => {
          // Allow Escape key to close dialogs
          if (event.key === 'Escape') {
            return false
          }
          // Block all other shortcuts
          return true
        }
      },
      // High priority to ensure it runs before other scopes
      priority: 100
    })
    // Push the scope to the top of the stack
    hotkeys.pushScope(scopeId)
    return () => {
      hotkeys.popScope(scopeId)
      unregister()
    }
  }, [hotkeys, isOpen, scopeId])
}