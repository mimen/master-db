// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.tsx (WorkingTimelineRow)

import { useEffect, useRef } from "react"

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

export function ThinkingIndicator({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const update = () => {
      if (ref.current) ref.current.textContent = formatElapsed(Date.now() - startedAt)
    }
    update()
    // Self-mutate via setInterval — avoids re-rendering on every tick.
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-[3px]">
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
      </span>
      <span data-testid="elapsed" ref={ref}>0s</span>
    </div>
  )
}
