// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { QueueFilterBar } from "./QueueFilterBar"

const defaults = {
  filter: "all-open" as const,
  sort: "urgency" as const,
  onFilterChange: vi.fn(),
  onSortChange: vi.fn(),
}

describe("QueueFilterBar", () => {
  test("renders the primary pair and four status chips", () => {
    render(<QueueFilterBar {...defaults} />)
    expect(screen.getByText("All open")).toBeInTheDocument()
    expect(screen.getByText("Closed")).toBeInTheDocument()
    expect(screen.getByText("Awaiting decision")).toBeInTheDocument()
    expect(screen.getByText("Thinking")).toBeInTheDocument()
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.getByText("Error")).toBeInTheDocument()
  })

  test("active filter chip has filled style", () => {
    render(<QueueFilterBar {...defaults} filter="all-open" />)
    const allOpen = screen.getByText("All open").closest("button")
    expect(allOpen?.className).toContain("bg-primary")
    const closed = screen.getByText("Closed").closest("button")
    expect(closed?.className).not.toContain("bg-primary")
  })

  test("a single status filter highlights only that chip", () => {
    render(<QueueFilterBar {...defaults} filter="awaiting_decision" />)
    const awaiting = screen.getByText("Awaiting decision").closest("button")
    expect(awaiting?.className).toContain("bg-primary")
    const allOpen = screen.getByText("All open").closest("button")
    expect(allOpen?.className).not.toContain("bg-primary")
  })

  test("clicking Closed emits the closed filter", () => {
    const onFilterChange = vi.fn()
    render(<QueueFilterBar {...defaults} onFilterChange={onFilterChange} />)
    fireEvent.click(screen.getByText("Closed"))
    expect(onFilterChange).toHaveBeenCalledWith("closed")
  })

  test("clicking Awaiting decision emits awaiting_decision", () => {
    const onFilterChange = vi.fn()
    render(<QueueFilterBar {...defaults} onFilterChange={onFilterChange} />)
    fireEvent.click(screen.getByText("Awaiting decision"))
    expect(onFilterChange).toHaveBeenCalledWith("awaiting_decision")
  })

  test("clicking All open emits all-open", () => {
    const onFilterChange = vi.fn()
    render(
      <QueueFilterBar {...defaults} filter="closed" onFilterChange={onFilterChange} />,
    )
    fireEvent.click(screen.getByText("All open"))
    expect(onFilterChange).toHaveBeenCalledWith("all-open")
  })

  test("sort dropdown emits new sort on change", () => {
    const onSortChange = vi.fn()
    render(<QueueFilterBar {...defaults} onSortChange={onSortChange} />)
    const dropdownTrigger = screen.getByLabelText(/Sort/i)
    fireEvent.change(dropdownTrigger, { target: { value: "recent" } })
    expect(onSortChange).toHaveBeenCalledWith("recent")
  })
})
