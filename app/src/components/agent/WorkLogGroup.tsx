// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.tsx
//                    (Work-log section rendering + expand control)

import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"

import { ToolCallCard } from "./ToolCallCard"

import type { ThreadRow } from "@/lib/agent/convertMessage"

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

  return (
    <div className="my-2 rounded-md border bg-card/50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>Work log · {items.length} item{items.length === 1 ? "" : "s"}</span>
      </button>
      {expanded && (
        <ul className="px-3 py-1 text-xs border-t">
          {items.map((r) => {
            if (r.row_type === "activity" && r.kind === "tool_call") {
              return (
                <li key={r._id} className="py-1">
                  <ToolCallCard
                    name={r.name ?? "unknown"}
                    status={r.status ?? "pending"}
                    input={r.input_json}
                    output={r.output_json}
                  />
                </li>
              )
            }
            const content = (r.body_markdown ?? "").trim()
            if (!content) return null
            return (
              <li key={r._id} className="py-1 text-foreground/80 flex items-center gap-1">
                <ChevronDown className="h-3 w-3 opacity-30" />
                <span className="truncate">{content}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
