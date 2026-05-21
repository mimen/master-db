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

  test("singular item count in header", () => {
    render(<WorkLogGroup items={items(1)} firstSequence={1} lastSequence={1} run_id="r1" />)
    expect(screen.getByText(/Work log · 1 item$/)).toBeInTheDocument()
  })

  test("collapsed by default — no items rendered", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    // Header present
    expect(screen.getByText(/Work log · 7 items/)).toBeInTheDocument()
    // No tool-call names and no log-entry text visible
    expect(screen.queryByText("step 0")).toBeNull()
    expect(screen.queryByText("step 6")).toBeNull()
    expect(screen.queryByText("Read")).toBeNull()
  })

  test("clicking the header expands to reveal all items", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    expect(screen.queryByText("step 0")).toBeNull()
    fireEvent.click(screen.getByText(/Work log · 7 items/))
    // All items now render — first, last, and a tool-call name
    expect(screen.getByText("step 0")).toBeInTheDocument()
    expect(screen.getByText("step 6")).toBeInTheDocument()
    expect(screen.getAllByText("Read").length).toBeGreaterThan(0)
  })

  test("clicking the header again collapses back", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    const header = screen.getByText(/Work log · 7 items/)
    fireEvent.click(header)
    expect(screen.getByText("step 0")).toBeInTheDocument()
    fireEvent.click(header)
    expect(screen.queryByText("step 0")).toBeNull()
  })

  test("reasoning row with null body_markdown is skipped when expanded — no orphan chevron", () => {
    const mixedItems: ThreadRow[] = [
      {
        _id: "t1", row_type: "activity", sequence: 1, run_id: "r1",
        kind: "tool_call", body_markdown: null, name: "Read",
        input_json: {}, output_json: {}, status: "ok",
        proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
        resolved_at: null,
      },
      {
        _id: "r1", row_type: "message", sequence: 2, run_id: "r1",
        kind: "reasoning", body_markdown: null, name: undefined,
        input_json: {}, output_json: {}, status: "ok",
        proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
        resolved_at: null,
      },
      {
        _id: "t2", row_type: "activity", sequence: 3, run_id: "r1",
        kind: "tool_call", body_markdown: null, name: "Bash",
        input_json: {}, output_json: {}, status: "ok",
        proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
        resolved_at: null,
      },
    ]
    const { container } = render(
      <WorkLogGroup items={mixedItems} firstSequence={1} lastSequence={3} run_id="r1" />
    )
    // Expand the group first
    fireEvent.click(screen.getByText(/Work log · 3 items/))
    // Should have exactly 2 <li> items (the two tool_call rows), no phantom caret li
    const listItems = container.querySelectorAll("ul > li")
    expect(listItems).toHaveLength(2)
  })
})
