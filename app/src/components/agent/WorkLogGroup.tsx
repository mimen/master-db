// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.tsx
//                    (Work-log section rendering + expand control)

import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"

import type { ThreadRow } from "@/lib/agent/convertMessage"

const MAX_VISIBLE = 3

function rowLabel(r: ThreadRow): string {
  if (r.row_type === "activity") return `${r.name ?? "tool"} · ${r.status ?? ""}`
  return r.body_markdown ?? r.kind
}

export function WorkLogGroup({
  items,
  firstSequence,
  lastSequence,
  run_id,
}: {
  items: ThreadRow[]
  firstSequence: number
  lastSequence: number
  run_id: string
}) {
  void firstSequence; void lastSequence; void run_id  // reserved for elapsed-time / cross-link
  const [expanded, setExpanded] = useState(false)
  const visible = expanded || items.length <= MAX_VISIBLE
    ? items
    : items.slice(items.length - MAX_VISIBLE)
  const hiddenCount = items.length - visible.length

  return (
    <div className="my-2 rounded-md border bg-card/50">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b">
        <span>Work log · {items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="px-3 py-1 text-xs">
        {hiddenCount > 0 && !expanded && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 py-1"
            >
              <ChevronRight className="h-3 w-3" />
              Show all {items.length} →
            </button>
          </li>
        )}
        {visible.map((r) => (
          <li key={r._id} className="py-1 text-foreground/80 flex items-center gap-1">
            <ChevronDown className="h-3 w-3 opacity-30" />
            <span className="truncate">{rowLabel(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
