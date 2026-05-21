// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { useQuery } from "convex/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { QueueView } from "./QueueView"

const sampleItems = [
  { entity_ref: "todoist:task:a", entity_type: "todoist_task", entity_id: "a", entity_title: "First task", status: "awaiting_decision", last_urgency: 0.9, updated_at: 100 },
  { entity_ref: "todoist:task:b", entity_type: "todoist_task", entity_id: "b", entity_title: "Second task", status: "awaiting_decision", last_urgency: 0.5, updated_at: 50 },
]

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => sampleItems),
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: { agentic: { queries: { listAwaitingDecision: { default: "stub" }, getThread: { default: "stub" }, getRun: { default: "stub" } }, actions: { postRun: { default: "stub" } } } },
}))
vi.mock("./AgentSurface", () => ({
  AgentSurface: ({ entity_ref }: { entity_ref: string }) => <div data-testid="agent-surface">{entity_ref}</div>,
}))

describe("QueueView", () => {
  beforeEach(() => {
    vi.mocked(useQuery).mockReturnValue(sampleItems)
  })

  test("renders both rows from the query", () => {
    render(<QueueView />)
    expect(screen.getByText("First task")).toBeTruthy()
    expect(screen.getByText("Second task")).toBeTruthy()
  })

  test("clicking a row focuses it and the right pane shows that entity_ref", () => {
    render(<QueueView />)
    // Auto-focuses the first row on mount.
    expect(screen.getByTestId("agent-surface").textContent).toBe("todoist:task:a")
    fireEvent.click(screen.getByText("Second task"))
    expect(screen.getByTestId("agent-surface").textContent).toBe("todoist:task:b")
  })

  test("shows empty state when the query returns []", () => {
    vi.mocked(useQuery).mockReturnValue([])
    render(<QueueView />)
    expect(screen.getByText(/Nothing awaiting/i)).toBeTruthy()
  })
})
