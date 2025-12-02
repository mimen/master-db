import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

interface HeaderSlotContextValue {
  slots: Map<string, ReactNode>
  registerSlot: (id: string, content: ReactNode) => void
  unregisterSlot: (id: string) => void
}

const HeaderSlotContext = createContext<HeaderSlotContextValue | null>(null)

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Map<string, ReactNode>>(new Map())

  const registerSlot = useCallback((id: string, content: ReactNode) => {
    setSlots((prev) => new Map(prev).set(id, content))
  }, [])

  const unregisterSlot = useCallback((id: string) => {
    setSlots((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  return (
    <HeaderSlotContext.Provider value={{ slots, registerSlot, unregisterSlot }}>
      {children}
    </HeaderSlotContext.Provider>
  )
}

export function useHeaderSlot() {
  const context = useContext(HeaderSlotContext)
  if (!context) {
    throw new Error("useHeaderSlot must be used within HeaderSlotProvider")
  }
  return context
}

/**
 * Hook to register content to a header slot with automatic cleanup.
 * Content is registered on mount and unregistered on unmount.
 *
 * @param slotId - Unique identifier for the slot (e.g., 'view-settings')
 * @param content - React content to render in the slot (null to clear)
 */
export function useHeaderSlotContent(slotId: string, content: ReactNode) {
  const { registerSlot, unregisterSlot } = useHeaderSlot()

  useEffect(() => {
    if (content !== null) {
      registerSlot(slotId, content)
    } else {
      unregisterSlot(slotId)
    }
    return () => unregisterSlot(slotId)
  }, [slotId, content, registerSlot, unregisterSlot])
}
