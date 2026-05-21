// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { AgentStatusBadge } from "./AgentStatusBadge"

type RunRow = {
  status: string
  last_urgency?: number | null
} | null | undefined

let mockRun: RunRow = null
const mockOpen = vi.fn()
const mockPostRun = vi.fn().mockResolvedValue(undefined)

vi.mock("convex/react", () => ({
  useQuery: () => mockRun,
  useAction: () => mockPostRun,
}))

vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      queries: { getRun: { default: "stub.agentic.queries.getRun" } },
      actions: { postRun: { default: "stub.agentic.actions.postRun" } },
    },
  },
}))

vi.mock("@/contexts/AgentDrawerContext", () => ({
  useAgentDrawer: () => ({ open: mockOpen }),
}))

describe("AgentStatusBadge", () => {
  beforeEach(() => {
    mockRun = null
    mockOpen.mockClear()
    mockPostRun.mockClear()
  })

  test("renders nothing when no run row exists", () => {
    mockRun = null
    const { container } = render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    expect(container.firstChild).toBeNull()
  })

  test("renders nothing while loading (undefined)", () => {
    mockRun = undefined
    const { container } = render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    expect(container.firstChild).toBeNull()
  })

  test("does not tint rose when status is awaiting_decision but urgency is null", () => {
    mockRun = { status: "awaiting_decision", last_urgency: null }
    render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    const btn = screen.getByRole("button")
    expect(btn.className).not.toMatch(/rose/)
    expect(btn.className).toMatch(/amber/)
  })

  test("does not tint rose when status is awaiting_decision but urgency is missing", () => {
    mockRun = { status: "awaiting_decision" }
    render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    const btn = screen.getByRole("button")
    expect(btn.className).not.toMatch(/rose/)
  })

  test("does not tint rose when urgency is below 0.85", () => {
    mockRun = { status: "awaiting_decision", last_urgency: 0.7 }
    render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    const btn = screen.getByRole("button")
    expect(btn.className).not.toMatch(/rose/)
  })

  test("tints rose when status is awaiting_decision AND urgency >= 0.85", () => {
    mockRun = { status: "awaiting_decision", last_urgency: 0.9 }
    render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    const btn = screen.getByRole("button")
    expect(btn.className).toMatch(/rose/)
  })

  test("does not tint rose when urgency >= 0.85 but status is not awaiting_decision", () => {
    mockRun = { status: "discovering", last_urgency: 0.95 }
    render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    const btn = screen.getByRole("button")
    expect(btn.className).not.toMatch(/rose/)
    expect(btn.className).toMatch(/blue/)
  })

  test("renders idle badge unchanged when no urgency present", () => {
    mockRun = { status: "idle" }
    render(<AgentStatusBadge entity_ref="todoist:task:1" />)
    expect(screen.getByText("Agent")).toBeInTheDocument()
  })

  describe("standard mode (no agentMode)", () => {
    test("clicking an idle badge fires discovery and does NOT open the drawer", () => {
      mockRun = { status: "idle" }
      render(<AgentStatusBadge entity_ref="todoist:task:1" />)
      fireEvent.click(screen.getByRole("button"))
      expect(mockPostRun).toHaveBeenCalledTimes(1)
      expect(mockOpen).not.toHaveBeenCalled()
    })

    test("clicking a non-idle badge opens the drawer", () => {
      mockRun = { status: "awaiting_decision", last_urgency: 0.4 }
      render(<AgentStatusBadge entity_ref="todoist:task:1" />)
      fireEvent.click(screen.getByRole("button"))
      expect(mockOpen).toHaveBeenCalledWith("todoist:task:1")
      expect(mockPostRun).not.toHaveBeenCalled()
    })
  })

  describe("agent mode", () => {
    test("clicking calls onSelect with the entity_ref and does NOT open the drawer or fire discovery", () => {
      mockRun = { status: "awaiting_decision", last_urgency: 0.4 }
      const onSelect = vi.fn()
      render(
        <AgentStatusBadge entity_ref="todoist:task:1" agentMode onSelect={onSelect} />,
      )
      fireEvent.click(screen.getByRole("button"))
      expect(onSelect).toHaveBeenCalledWith("todoist:task:1")
      expect(mockOpen).not.toHaveBeenCalled()
      expect(mockPostRun).not.toHaveBeenCalled()
    })

    test("clicking an idle badge in agent mode selects rather than firing discovery", () => {
      mockRun = { status: "idle" }
      const onSelect = vi.fn()
      render(
        <AgentStatusBadge entity_ref="todoist:task:1" agentMode onSelect={onSelect} />,
      )
      fireEvent.click(screen.getByRole("button"))
      expect(onSelect).toHaveBeenCalledWith("todoist:task:1")
      expect(mockPostRun).not.toHaveBeenCalled()
      expect(mockOpen).not.toHaveBeenCalled()
    })

    test("renders null when no run even in agent mode", () => {
      mockRun = null
      const { container } = render(
        <AgentStatusBadge entity_ref="todoist:task:1" agentMode onSelect={vi.fn()} />,
      )
      expect(container.firstChild).toBeNull()
    })
  })
})
