// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { QueueFilterBar } from "./QueueFilterBar"

const defaults = {
  statuses: ["awaiting_decision"],
  sort: "urgency" as const,
  onStatusesChange: vi.fn(),
  onSortChange: vi.fn(),
}

describe("QueueFilterBar", () => {
  test("renders all four status chips", () => {
    render(<QueueFilterBar {...defaults} />)
    expect(screen.getByText(/Awaiting/i)).toBeInTheDocument()
    expect(screen.getByText(/Thinking/i)).toBeInTheDocument()
    expect(screen.getByText(/Running/i)).toBeInTheDocument()
    expect(screen.getByText(/Error/i)).toBeInTheDocument()
  })

  test("active status chip has filled style", () => {
    render(<QueueFilterBar {...defaults} />)
    const awaitingChip = screen.getByText(/Awaiting/i).closest("button")
    expect(awaitingChip?.className).toContain("bg-primary")
  })

  test("clicking a chip toggles status set", () => {
    const onStatusesChange = vi.fn()
    render(<QueueFilterBar {...defaults} onStatusesChange={onStatusesChange} />)
    fireEvent.click(screen.getByText(/Error/i))
    expect(onStatusesChange).toHaveBeenCalledWith(["awaiting_decision", "error"])
  })

  test("clicking the active chip removes it", () => {
    const onStatusesChange = vi.fn()
    render(<QueueFilterBar {...defaults} onStatusesChange={onStatusesChange} />)
    fireEvent.click(screen.getByText(/Awaiting/i))
    expect(onStatusesChange).toHaveBeenCalledWith([])
  })

  test("sort dropdown emits new sort on change", () => {
    const onSortChange = vi.fn()
    render(<QueueFilterBar {...defaults} onSortChange={onSortChange} />)
    const dropdownTrigger = screen.getByLabelText(/Sort/i)
    fireEvent.change(dropdownTrigger, { target: { value: "recent" } })
    expect(onSortChange).toHaveBeenCalledWith("recent")
  })
})
