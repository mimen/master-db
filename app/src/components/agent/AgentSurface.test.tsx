// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

const META = {
  entity_id: "abc",
  entity_type: "todoist_task",
  entity_ref: "todoist:task:abc",
  entity_title: "Email Sarah re: venue",
  priority: 4,
  due: "2026-06-01",
  deadline: "2026-06-10",
  labels: [{ name: "urgent", color: "red" }],
  project: { name: "AUF", color: "lavender" },
  status: "awaiting_decision",
  checked: false,
}

let queryResult: unknown = META

// Distinct mock fns so the test can assert specifically on each action.
const completeTaskMock = vi.fn().mockResolvedValue({ success: true, data: true })
const reopenTaskMock = vi.fn().mockResolvedValue({ success: true, data: true })
const genericActionMock = vi.fn().mockResolvedValue({ accepted: true })

vi.mock("convex/react", () => ({
  // The action ref string identifies which action is being bound (see api mock
  // below): "todoist.completeTask" → completeTaskMock, "todoist.reopenTask" →
  // reopenTaskMock, anything else (e.g. postRun) → genericActionMock.
  useAction: (ref: unknown) =>
    ref === "todoist.completeTask"
      ? completeTaskMock
      : ref === "todoist.reopenTask"
        ? reopenTaskMock
        : genericActionMock,
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
        reopenTask: { reopenTask: "todoist.reopenTask" },
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
    reopenTaskMock.mockClear()
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

  test("renders a markdown-link title as an anchor", () => {
    queryResult = { ...META, entity_title: "See [doc](https://x.com)" }
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    const link = screen.getByRole("link", { name: "doc" })
    expect(link).toHaveAttribute("href", "https://x.com")
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
    expect(screen.getByText(/Awaiting decision/i)).toBeInTheDocument()
  })

  test("clicking the circle when open calls completeTask with the meta entity_id", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /complete task/i }))
    expect(completeTaskMock).toHaveBeenCalledTimes(1)
    expect(completeTaskMock).toHaveBeenCalledWith({ todoistId: "abc" })
    expect(reopenTaskMock).not.toHaveBeenCalled()
  })

  test("clicking the circle when already completed calls reopenTask (uncomplete toggle)", () => {
    queryResult = { ...META, checked: true }
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /reopen task/i }))
    expect(reopenTaskMock).toHaveBeenCalledTimes(1)
    expect(reopenTaskMock).toHaveBeenCalledWith({ todoistId: "abc" })
    expect(completeTaskMock).not.toHaveBeenCalled()
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

  test("does not render the complete circle for non-todoist entities", () => {
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
    expect(screen.queryByRole("button", { name: /reopen task/i })).not.toBeInTheDocument()
  })

  test("renders a label chip from meta.labels", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    expect(screen.getByText("urgent")).toBeInTheDocument()
  })

  test("renders due and deadline date chips from meta", () => {
    render(
      <AgentComposerProvider>
        <AgentSurface entity_ref="todoist:task:abc" />
      </AgentComposerProvider>,
    )
    // due (2026-06-01) and deadline (2026-06-10) are distinct future dates;
    // formatSmartDate renders absolute "Jun 1" / "Jun 10" style text.
    expect(screen.getByText(/Jun 1\b/)).toBeInTheDocument()
    expect(screen.getByText(/Jun 10/)).toBeInTheDocument()
  })
})
