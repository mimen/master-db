import { useEffect, useRef } from "react"

type Opts = {
  enabled: boolean
  openForActiveTask: () => void
}

const CHORD_TIMEOUT_MS = 500

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

export function useAgentKeybindings({ enabled, openForActiveTask }: Opts) {
  const lastGAt = useRef<number>(0)
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const now = Date.now()
      if (e.key === "g") {
        lastGAt.current = now
        return
      }
      if (e.key === "a" && now - lastGAt.current <= CHORD_TIMEOUT_MS) {
        lastGAt.current = 0
        openForActiveTask()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled, openForActiveTask])
}
