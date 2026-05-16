// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.logic.ts

import type { ThreadRow } from "./convertMessage"

export type WorkLogTimelineItem =
  | { type: "row"; row: ThreadRow }
  | {
      type: "group"
      items: ThreadRow[]
      firstSequence: number
      lastSequence: number
      run_id: string
    }

const PROCESS_KINDS = new Set(["reasoning", "tool_call"])

// Rows that break (scatter) any adjacent process group rather than just ending it
const BREAK_KINDS = new Set([
  "proposal",
  "clarification",
  "blocked",
])

function isProcessRow(r: ThreadRow): boolean {
  return PROCESS_KINDS.has(r.kind)
}

function isBreakRow(r: ThreadRow): boolean {
  return BREAK_KINDS.has(r.kind)
}

export function groupWorkLog(rows: ThreadRow[]): WorkLogTimelineItem[] {
  const out: WorkLogTimelineItem[] = []
  let buffer: ThreadRow[] = []
  // true when this buffer should flush as individual rows rather than a group
  let bufferBroken = false
  // true when the most recent non-process row was a break-kind (e.g. proposal)
  let prevWasBreak = false

  function flushBuffer(broken = false) {
    if (buffer.length === 0) return
    if (bufferBroken || broken) {
      for (const buffered of buffer) {
        out.push({ type: "row", row: buffered })
      }
    } else {
      out.push({
        type: "group",
        items: buffer,
        firstSequence: buffer[0].sequence,
        lastSequence: buffer[buffer.length - 1].sequence,
        run_id: buffer[0].run_id,
      })
    }
    buffer = []
    bufferBroken = false
  }

  for (const r of rows) {
    if (isProcessRow(r)) {
      if (buffer.length === 0) {
        // Start fresh buffer; inherit break context from preceding non-process row
        bufferBroken = prevWasBreak
        prevWasBreak = false
        buffer.push(r)
        continue
      }
      if (buffer[buffer.length - 1].run_id === r.run_id) {
        // Same run — extend buffer
        buffer.push(r)
        continue
      }
      // run_id mismatch — both the old buffer and this new row are broken
      flushBuffer(true)
      bufferBroken = true
      prevWasBreak = false
      buffer.push(r)
      continue
    }
    // Non-process row: if it's a break-kind, scatter the buffer
    const breaking = isBreakRow(r)
    flushBuffer(breaking)
    prevWasBreak = breaking
    out.push({ type: "row", row: r })
  }
  flushBuffer()
  return out
}
