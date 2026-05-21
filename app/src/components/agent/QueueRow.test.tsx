// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { QueueRow, type QueueRowItem } from "./QueueRow"

const item: QueueRowItem = {
  entity_ref: "todoist:task:abc",
  entity_type: "todoist_task",
  entity_title: "Email Sarah re: venue",
  status: "awaiting_decision",
  last_urgency: 0.92,
  updated_at: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
  priority: 4, // Todoist API 4 = UI P1 (highest)
  due: "2099-01-15",
  project: { name: "AUF", color: "lavender" },
}

describe("QueueRow", () => {
  test("renders title + status pill + urgency chip", () => {
    render(<QueueRow item={item} focused={false} onFocus={() => {}} />)
    expect(screen.getByText(/Email Sarah/)).toBeInTheDocument()
    expect(screen.getByText(/Awaiting/i)).toBeInTheDocument()
    expect(screen.getByText("0.92")).toBeInTheDocument()
  })

  test("hides urgency chip when last_urgency is null", () => {
    render(
      <QueueRow item={{ ...item, last_urgency: null }} focused={false} onFocus={() => {}} />,
    )
    expect(screen.queryByText(/0\.\d/)).toBeNull()
  })

  test("click fires onFocus with the entity_ref", () => {
    const onFocus = vi.fn()
    render(<QueueRow item={item} focused={false} onFocus={onFocus} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onFocus).toHaveBeenCalledWith("todoist:task:abc")
  })

  test("focused=true adds focus accent class", () => {
    const { container } = render(<QueueRow item={item} focused onFocus={() => {}} />)
    expect(container.querySelector(".border-l-primary")).toBeTruthy()
  })

  test("renders the project name when project is present", () => {
    render(<QueueRow item={item} focused={false} onFocus={() => {}} />)
    expect(screen.getByText("AUF")).toBeInTheDocument()
  })

  test("renders a priority flag for a flagged priority", () => {
    render(<QueueRow item={item} focused={false} onFocus={() => {}} />)
    // Todoist API priority 4 maps to UI P1 (highest, flagged)
    expect(screen.getByText("P1")).toBeInTheDocument()
  })

  test("does not render a project badge when project is null", () => {
    render(
      <QueueRow item={{ ...item, project: null }} focused={false} onFocus={() => {}} />,
    )
    expect(screen.queryByText("AUF")).toBeNull()
  })
})
