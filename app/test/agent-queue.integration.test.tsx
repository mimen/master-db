// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

const items = [
  { entity_ref: "todoist:task:a", entity_type: "todoist_task", entity_id: "a", entity_title: "First task", status: "awaiting_decision", last_urgency: 0.9, updated_at: 100 },
  { entity_ref: "todoist:task:b", entity_type: "todoist_task", entity_id: "b", entity_title: "Second task", status: "awaiting_decision", last_urgency: 0.5, updated_at: 50 },
]

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown) => {
    if (String(fn).includes("listAwaitingDecision")) return items
    return undefined
  },
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      queries: { listAwaitingDecision: { default: "listAwaitingDecision" }, getThread: { default: "getThread" }, getRun: { default: "getRun" } },
      actions: { postRun: { default: "postRun" } },
    },
  },
}))
vi.mock("@/components/agent/AgentSurface", () => ({
  AgentSurface: ({ entity_ref }: { entity_ref: string }) => <div data-testid="agent-surface">{entity_ref}</div>,
}))

import { QueueView } from "@/components/agent/QueueView"

describe("agent queue integration", () => {
  test("open → rows render → j focuses next → right pane updates", async () => {
    render(<QueueView />)
    expect(await screen.findByText("First task")).toBeInTheDocument()
    expect(screen.getByText("Second task")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
    })
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }))
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:b")
    })
  })
})
