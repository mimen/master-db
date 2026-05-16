// @vitest-environment jsdom
import { render, screen, act } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { AgentDrawer } from "./AgentDrawer"

import { AgentDrawerProvider, useAgentDrawer } from "@/contexts/AgentDrawerContext"

vi.mock("convex/react", () => ({
  useAction: () => vi.fn().mockResolvedValue({ run_id: "r1", status: "idle", accepted: false }),
}))

vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      actions: {
        postRun: { default: "stub.agentic.actions.postRun" },
        postInterrupt: { default: "stub.agentic.actions.postInterrupt" },
      },
    },
  },
}))

vi.mock("./AgentTranscript", () => ({
  AgentTranscript: ({ entity_ref }: { entity_ref: string }) => (
    <div data-testid="agent-transcript">{entity_ref}</div>
  ),
}))

vi.mock("@/hooks/useAgentRuntime", () => ({
  useAgentRuntime: () => ({ isRunning: false, runtime: null, rows: [], run: null, isLoading: false }),
}))

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: () => ({ send: vi.fn(), interrupt: vi.fn(), execute: vi.fn(), modify: vi.fn() }),
}))

function Harness() {
  const { open } = useAgentDrawer()
  return <button onClick={() => open("todoist:task:1")}>open</button>
}

describe("AgentDrawer", () => {
  test("renders nothing when closed", () => {
    render(
      <AgentDrawerProvider>
        <AgentDrawer />
      </AgentDrawerProvider>,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("renders sheet when open", () => {
    render(
      <AgentDrawerProvider>
        <Harness />
        <AgentDrawer />
      </AgentDrawerProvider>,
    )
    act(() => {
      screen.getByText("open").click()
    })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
