import { useEffect, useRef } from "react"

export interface UseAgentQueueKeybindingsOpts {
  enabled: boolean
  onNext: () => void
  onPrev: () => void
  onExecuteOption: (index: number) => void // index 0..3 for keys 1..4
  onModify: () => void
  onExecuteRecommended: () => void
  onClearFocus: () => void
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

export function useAgentQueueKeybindings(opts: UseAgentQueueKeybindingsOpts) {
  // Keep the latest callbacks in a ref so the listener binds once per
  // `enabled` change rather than re-binding on every render (callers pass a
  // fresh opts object literal). The handler always reads current callbacks.
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    if (!opts.enabled) return
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const o = optsRef.current
      switch (e.key) {
        case "j":
        case "ArrowDown":
          o.onNext()
          return
        case "k":
        case "ArrowUp":
          o.onPrev()
          return
        case "1":
        case "2":
        case "3":
        case "4":
          o.onExecuteOption(Number(e.key) - 1)
          return
        case "m":
          o.onModify()
          return
        case "e":
          o.onExecuteRecommended()
          return
        case "Escape":
          o.onClearFocus()
          return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [opts.enabled])
}
