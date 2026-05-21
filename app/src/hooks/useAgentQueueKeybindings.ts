import { useEffect } from "react"

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
  useEffect(() => {
    if (!opts.enabled) return
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case "j":
        case "ArrowDown":
          opts.onNext()
          return
        case "k":
        case "ArrowUp":
          opts.onPrev()
          return
        case "1":
        case "2":
        case "3":
        case "4":
          opts.onExecuteOption(Number(e.key) - 1)
          return
        case "m":
          opts.onModify()
          return
        case "e":
          opts.onExecuteRecommended()
          return
        case "Escape":
          opts.onClearFocus()
          return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [opts])
}
