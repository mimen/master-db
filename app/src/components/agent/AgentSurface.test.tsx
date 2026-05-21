// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

const META = {
  entity_id: "abc",
  entity_type: "todoist_task",
  entity_ref: "todoist:task:abc",
  entity_title: "Email Sarah re: venue",
  priority: 4,
  due: null,
  project: { name: "AUF", color: "lavender" },
  status: "awaiting_decision",
  checked: false,
}

let queryResult: unknown = META

// Distinct mock fns so the test can assert specifically on completeTask.
const completeTaskMock = vi.fn().mockResolvedValue({ success: true, data: true })
const genericActionMock = vi.fn().mockResolvedValue({ accepted: true })

vi.mock("convex/react", () => ({
  // The action ref string identifies which action is being bound; the
  // completeTask action ref is "todoist.completeTask" (see api mock below).
  useAction: (ref: unknown) =>
    ref === "todoist.completeTask" ? completeTaskMock : genericActionMock,
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
    todoist: {
      actions: {
        completeTask: { completeTask: "todoist.completeTask" },
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
    completeTaskMock.mockClear()
    genericActionMock.mockClear()
  })

  test("renders the real task title, the thread id, and project from meta", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText("Email Sarah re: venue")).toBeInTheDocument()
    // Thread id (entity_ref slug) now always renders as muted secondary text.
    expect(screen.getByText("todoist:task:abc")).toBeInTheDocument()
    expect(screen.getByText("AUF")).toBeInTheDocument()
  })

  test("falls back to entity_ref slug as title when meta is null", () => {
    queryResult = null
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    // Slug appears both as the fallback title and the secondary thread id.
    expect(screen.getAllByText("todoist:task:abc").length).toBeGreaterThanOrEqual(1)
  })

  test("renders status pill from run.status", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText(/Awaiting you/i)).toBeInTheDocument()
  })

  test("clicking Complete calls completeTask with the meta entity_id", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /complete task/i }))
    expect(completeTaskMock).toHaveBeenCalledTimes(1)
    expect(completeTaskMock).toHaveBeenCalledWith({ todoistId: "abc" })
  })

  test("falls back to parsing entity_ref for the id when meta is null", () => {
    queryResult = null
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:xyz" />
      </AgentComposerProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /complete task/i }))
    expect(completeTaskMock).toHaveBeenCalledWith({ todoistId: "xyz" })
  })

  test("does not show an active Complete button when the task is already completed", () => {
    queryResult = { ...META, checked: true }
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.queryByRole("button", { name: /complete task/i })).not.toBeInTheDocument()
  })

  test("does not render a Complete button for non-todoist entities", () => {
    queryResult = {
      ...META,
      entity_type: "gmail_thread",
      entity_ref: "gmail:thread:123",
    }
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="gmail:thread:123" />
      </AgentComposerProvider>,
    )
    expect(screen.queryByRole("button", { name: /complete task/i })).not.toBeInTheDocument()
  })
})
