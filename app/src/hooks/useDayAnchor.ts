import { useEffect, useState } from "react"

/**
 * The time to judge "today" by, re-read at each local midnight. Convex
 * queries that took the server clock never re-ran when the day changed, so
 * day-relative queries take this as their `now` argument instead.
 */
export function useDayAnchor(): number {
  const [anchor, setAnchor] = useState(Date.now)
  useEffect(() => {
    const midnight = new Date(anchor)
    midnight.setHours(24, 0, 0, 0)
    const timer = window.setTimeout(() => setAnchor(Date.now()), Math.max(1_000, midnight.getTime() - Date.now()))
    return () => window.clearTimeout(timer)
  }, [anchor])
  return anchor
}
