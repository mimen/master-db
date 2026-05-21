// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

vi.mock("convex/react", () => ({
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
  useQuery: vi.fn().mockReturnValue(undefined),
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      actions: {
        postRun: { default: "stub" },
        postInterrupt: { default: "stub" },
      },
      queries: { getThread: { default: "stub" }, getRun: { default: "stub" } },
    },
  },
}))
vi.mock("./AgentTranscript", () => ({
  AgentTranscript: () => <div data-testid="agent-transcript" />,
}))
vi.mock("@/hooks/useAgentRuntime", () => ({
  useAgentRuntime: () => ({
    runtime: { _kind: "runtime" },
    rows: [],
    run: { status: "awaiting_decision" },
    isRunning: false,
    isLoading: false,
  }),
}))

import { AgentSurface } from "./AgentSurface"

import { AgentComposerProvider } from "@/contexts/AgentComposerContext"

describe("AgentSurface", () => {
  test("renders entity_ref in the header", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText("todoist:task:abc")).toBeInTheDocument()
  })

  test("renders status pill from run.status", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText(/Awaiting you/i)).toBeInTheDocument()
  })
})
