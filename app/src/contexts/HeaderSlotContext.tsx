import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

interface HeaderSlotActions {
  registerSlot: (id: string, content: ReactNode) => void
  unregisterSlot: (id: string) => void
}

// Two contexts on purpose. Registrants (via useHeaderSlotContent) subscribe
// ONLY to the actions context, whose value is stable for the provider's
// lifetime. The slots map lives in a separate context that only the header
// renderer reads. This severs the feedback loop that otherwise occurs:
// register → setSlots → context value changes → every registrant re-renders
// → new inline JSX content → effect re-runs → register → ∞.
const HeaderSlotActionsContext = createContext<HeaderSlotActions | null>(null)
const HeaderSlotStateContext = createContext<Map<string, ReactNode> | null>(null)

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

  const actions = useMemo<HeaderSlotActions>(
    () => ({ registerSlot, unregisterSlot }),
    [registerSlot, unregisterSlot],
  )

  return (
    <HeaderSlotActionsContext.Provider value={actions}>
      <HeaderSlotStateContext.Provider value={slots}>
        {children}
      </HeaderSlotStateContext.Provider>
    </HeaderSlotActionsContext.Provider>
  )
}

function useHeaderSlotActions() {
  const context = useContext(HeaderSlotActionsContext)
  if (!context) {
    throw new Error("useHeaderSlotActions must be used within HeaderSlotProvider")
  }
  return context
}

/** Read the registered slots. For the header renderer only. */
export function useHeaderSlots() {
  const context = useContext(HeaderSlotStateContext)
  if (!context) {
    throw new Error("useHeaderSlots must be used within HeaderSlotProvider")
  }
  return context
}

/**
 * Renders the given slot ids in order. This is the ONLY component that should
 * subscribe to the slots state — keeping it a leaf prevents slot registration
 * from re-rendering ancestors (e.g. Layout) and their registrant children,
 * which would otherwise re-register content and loop forever.
 */
export function HeaderSlotOutlet({ ids }: { ids: string[] }) {
  const slots = useHeaderSlots()
  return (
    <>
      {ids.map((id) => (
        <Fragment key={id}>{slots.get(id) ?? null}</Fragment>
      ))}
    </>
  )
}

/**
 * Register content to a header slot with automatic cleanup. Content is
 * registered on mount/update and unregistered on unmount.
 *
 * Safe to call with unstable (inline JSX) content: registrants subscribe to
 * the stable actions context, so a slot update never re-renders the caller
 * and cannot feed back into an infinite loop.
 *
 * @param slotId - Unique identifier for the slot (e.g., 'view-settings')
 * @param content - React content to render in the slot (null to clear)
 */
export function useHeaderSlotContent(slotId: string, content: ReactNode) {
  const { registerSlot, unregisterSlot } = useHeaderSlotActions()

  useEffect(() => {
    if (content !== null) {
      registerSlot(slotId, content)
    } else {
      unregisterSlot(slotId)
    }
  }, [slotId, content, registerSlot, unregisterSlot])

  useEffect(
    () => () => unregisterSlot(slotId),
    [slotId, unregisterSlot],
  )
}
