// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { WorkLogGroup } from "./WorkLogGroup"

import type { ThreadRow } from "@/lib/agent/convertMessage"

function items(n: number): ThreadRow[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `i${i}`, row_type: i % 2 === 0 ? "message" : "activity",
    sequence: i + 1, run_id: "r1",
    kind: i % 2 === 0 ? "reasoning" : "tool_call",
    body_markdown: `step ${i}`,
    name: i % 2 === 1 ? "Read" : undefined,
    input_json: {}, output_json: {}, status: "ok",
    proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
    resolved_at: null,
  }) as ThreadRow)
}

describe("WorkLogGroup", () => {
  test("renders header with count", () => {
    render(<WorkLogGroup items={items(5)} firstSequence={1} lastSequence={5} run_id="r1" />)
    expect(screen.getByText(/Work log · 5 items/)).toBeInTheDocument()
  })

  test("renders only the last 3 items by default", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    expect(screen.queryByText("step 0")).toBeNull()
    expect(screen.getByText("step 6")).toBeInTheDocument()
  })

  test("Show all expands to reveal hidden items", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    expect(screen.queryByText("step 0")).toBeNull()
    fireEvent.click(screen.getByText(/Show all 7/))
    expect(screen.getByText("step 0")).toBeInTheDocument()
  })

  test("groups of <=3 do not show expand control", () => {
    render(<WorkLogGroup items={items(3)} firstSequence={1} lastSequence={3} run_id="r1" />)
    expect(screen.queryByText(/Show all/)).toBeNull()
  })
})
