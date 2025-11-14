import { useQuery } from "convex/react"
import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"

import { api } from "@/convex/_generated/api"
import { CountRegistry } from "@/lib/views/CountRegistry"
import type { ViewBuildContext, ViewKey } from "@/lib/views/types"

interface CountContextValue {
  registry: CountRegistry
  isLoaded: boolean
  getCountForView: (viewKey: ViewKey, context?: ViewBuildContext) => number
}

const CountContext = createContext<CountContextValue | null>(null)

/**
 * CountProvider fetches all list counts once and provides a CountRegistry
 * to all components in the tree.
 *
 * This is ~34% faster than making 4 separate count queries and ensures
 * all counts are consistent across the application.
 *
 * Usage:
 * ```tsx
 * function App() {
 *   return (
 *     <CountProvider>
 *       <YourApp />
 *     </CountProvider>
 *   )
 * }
 * ```
 */
export function CountProvider({ children }: { children: ReactNode }) {
  // Fetch all counts in a single query
  const listCounts = useQuery(api.todoist.computed.index.getAllListCounts, {})

  // Create registry instance (memoized to avoid recreation on every render)
  const registry = useMemo(() => {
    if (!listCounts) {
      return new CountRegistry({})
    }
    return new CountRegistry(listCounts)
  }, [listCounts])

  // Helper method for convenience
  const getCountForView = (viewKey: ViewKey, context?: ViewBuildContext): number => {
    return registry.getCountForView(viewKey, context)
  }

  const value: CountContextValue = {
    registry,
    isLoaded: !!listCounts && Object.keys(listCounts).length > 0,
    getCountForView,
  }

  return <CountContext.Provider value={value}>{children}</CountContext.Provider>
}

/**
 * Hook to access the CountRegistry.
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   const { getCountForView, isLoaded } = useCountRegistry()
 *
 *   const inboxCount = getCountForView("view:inbox")
 *   const priorityQueueCount = getCountForView("view:multi:priority-queue")
 *
 *   if (!isLoaded) return <Skeleton />
 *
 *   return <div>Inbox: {inboxCount}, Priority Queue: {priorityQueueCount}</div>
 * }
 * ```
 */
export function useCountRegistry(): CountContextValue {
  const context = useContext(CountContext)
  if (!context) {
    throw new Error("useCountRegistry must be used within a CountProvider")
  }
  return context
}
