// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

const META = {
  entity_title: "Email Sarah re: venue",
  priority: 4,
  due: null,
  project: { name: "AUF", color: "lavender" },
  status: "awaiting_decision",
}

let queryResult: unknown = META

vi.mock("convex/react", () => ({
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
  // Single fn; AgentTranscript is mocked so only getQueueEntityMeta consumes this.
  useQuery: () => queryResult,
}))
vi.mock("@/convex/_generated/api", () => ({
  api: {
    agentic: {
      actions: {
        postRun: { default: "stub" },
        postInterrupt: { default: "stub" },
      },
      queries: {
        getThread: { default: "stub" },
        getRun: { default: "stub" },
        getQueueEntityMeta: { default: "stub" },
      },
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
  beforeEach(() => {
    queryResult = META
  })

  test("renders the real task title and project from meta", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText("Email Sarah re: venue")).toBeInTheDocument()
    expect(screen.queryByText("todoist:task:abc")).not.toBeInTheDocument()
    expect(screen.getByText("AUF")).toBeInTheDocument()
  })

  test("falls back to entity_ref slug when meta is null", () => {
    queryResult = null
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
