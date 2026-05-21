// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { useQuery } from "convex/react"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { Router } from "wouter"
import { memoryLocation } from "wouter/memory-location"

import { QueueView } from "./QueueView"

/** Render a tree inside a wouter Router seeded at the given path (incl. ?query). */
function renderAt(ui: ReactElement, path = "/agent") {
  const { hook, searchHook } = memoryLocation({ path })
  return render(
    <Router hook={hook} searchHook={searchHook}>
      {ui}
    </Router>,
  )
}

const sampleItems = [
  { entity_ref: "todoist:task:a", entity_type: "todoist_task", entity_id: "a", entity_title: "First task", status: "awaiting_decision", last_urgency: 0.9, updated_at: 100, labels: [] },
  { entity_ref: "todoist:task:b", entity_type: "todoist_task", entity_id: "b", entity_title: "Second task", status: "awaiting_decision", last_urgency: 0.5, updated_at: 50, labels: [] },
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
    renderAt(<QueueView />)
    expect(screen.getByText("First task")).toBeTruthy()
    expect(screen.getByText("Second task")).toBeTruthy()
  })

  test("clicking a row focuses it and the right pane shows that entity_ref", () => {
    renderAt(<QueueView />)
    // Auto-focuses the first row on mount.
    expect(screen.getByTestId("agent-surface").textContent).toBe("todoist:task:a")
    fireEvent.click(screen.getByText("Second task"))
    expect(screen.getByTestId("agent-surface").textContent).toBe("todoist:task:b")
  })

  test("shows empty state when the query returns []", () => {
    vi.mocked(useQuery).mockReturnValue([])
    renderAt(<QueueView />)
    expect(screen.getByText(/Nothing awaiting/i)).toBeTruthy()
  })

  test("restores the focused task from ?task= instead of auto-focusing the first row", () => {
    renderAt(<QueueView />, "/agent?task=todoist:task:b")
    expect(screen.getByTestId("agent-surface").textContent).toBe("todoist:task:b")
  })
})
