import { describe, expect, test } from "vitest"

import type { ThreadRow } from "./convertMessage"
import { groupWorkLog, type WorkLogTimelineItem } from "./workLogGrouping"

function msg(seq: number, kind: string, run_id = "r1"): ThreadRow {
  return { _id: `m${seq}`, row_type: "message", sequence: seq, run_id, kind,
    body_markdown: "x", proposal_json: null, error_json: null,
    token_usage: null, checkpoint_id: null }
}
function act(seq: number, kind: string, run_id = "r1"): ThreadRow {
  return { _id: `a${seq}`, row_type: "activity", sequence: seq, run_id, kind,
    name: "Read", input_json: {}, output_json: {}, status: "ok", resolved_at: null }
}

describe("groupWorkLog", () => {
  test("empty array → empty result", () => {
    expect(groupWorkLog([])).toEqual([])
  })

  test("single user_message → single item, no group", () => {
    const r = groupWorkLog([msg(1, "user_message")])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ type: "row" })
  })

  test("consecutive reasoning + tool_call → grouped", () => {
    const r = groupWorkLog([
      msg(1, "user_message"),
      msg(2, "reasoning"),
      act(3, "tool_call"),
      act(4, "tool_call"),
      msg(5, "reasoning"),
      msg(6, "assistant_message"),
    ])
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ type: "row" })
    // Check items.length before toMatchObject to avoid bun test runner bug
    // where expect.any(Array) replaces the matched property on the object
    expect((r[1] as Extract<WorkLogTimelineItem, { type: "group" }>).items).toHaveLength(4)
    expect(r[1]).toMatchObject({ type: "group" })
    expect(r[2]).toMatchObject({ type: "row" })
  })

  test("run_id change breaks the group", () => {
    const r = groupWorkLog([
      msg(1, "reasoning", "r1"),
      msg(2, "reasoning", "r2"),
    ])
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ type: "row" })
    expect(r[1]).toMatchObject({ type: "row" })
  })

  test("proposal between reasoning blocks breaks the group", () => {
    const r = groupWorkLog([
      msg(1, "reasoning"),
      msg(2, "proposal"),
      msg(3, "reasoning"),
    ])
    expect(r).toHaveLength(3)
    expect(r.every((x) => x.type === "row")).toBe(true)
  })

  test("group preserves first/last sequence + run_id for header rendering", () => {
    const r = groupWorkLog([msg(2, "reasoning"), act(3, "tool_call")])
    const g = r[0] as Extract<WorkLogTimelineItem, { type: "group" }>
    expect(g.type).toBe("group")
    expect(g.firstSequence).toBe(2)
    expect(g.lastSequence).toBe(3)
    expect(g.run_id).toBe("r1")
  })

  test("single reasoning row is still a 1-item group (consistent surface for consumers)", () => {
    const r = groupWorkLog([msg(1, "reasoning")])
    expect(r[0]).toMatchObject({ type: "group", items: [expect.objectContaining({ _id: "m1" })] })
  })
})
