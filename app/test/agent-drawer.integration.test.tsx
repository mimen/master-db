// @vitest-environment jsdom
import { beforeAll, describe, expect, test, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// jsdom doesn't ship ResizeObserver; stub it so @assistant-ui/react doesn't blow up.
beforeAll(() => {
  if (typeof window !== "undefined" && !window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

const postRunMock = vi.fn().mockResolvedValue({ run_id: "r1", status: "awaiting_decision", accepted: true })
const postInterruptMock = vi.fn().mockResolvedValue({ status: "idle" })

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown, args: unknown) => {
    if (args === "skip") return undefined
    const fnStr = String(fn ?? "")
    if (fnStr.includes("getThread")) return happyThread
    if (fnStr.includes("getRun")) return happyRun
    return undefined
  },
  useAction: (fn: unknown) => {
    const fnStr = String(fn ?? "")
    if (fnStr.includes("postRun")) return postRunMock
    if (fnStr.includes("postInterrupt")) return postInterruptMock
    return vi.fn()
  },
}))

const happyThread = [
  { _id: "m1", row_type: "message", sequence: 1, run_id: "r1", kind: "user_message",
    body_markdown: "What should I do?", proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null },
  { _id: "p1", row_type: "message", sequence: 2, run_id: "r1", kind: "proposal",
    body_markdown: null,
    proposal_json: {
      kind: "proposal", summary: "Choose one", findings: ["x"],
      options: [{ id: "a", label: "Option A", description: "do A", confidence: 0.8, reversibility: "trivial" }],
      recommended_option_id: "a", free_text_allowed: true,
    },
    error_json: null, token_usage: null, checkpoint_id: "ck-1" },
]
const happyRun = { entity_ref: "todoist:task:int", status: "awaiting_decision", last_run_id: "r1" }

vi.mock("@/convex/_generated/api", () => ({
  api: { agentic: {
    queries: {
      getThread: { default: "stub.getThread" },
      getRun: { default: "stub.getRun" },
      getQueueEntityMeta: { default: "stub.getQueueEntityMeta" },
    },
    actions: {
      postRun: { default: "stub.agentic.actions.postRun" },
      postInterrupt: { default: "stub.agentic.actions.postInterrupt" },
    },
  },
  todoist: {
    actions: {
      completeTask: { completeTask: "stub.todoist.actions.completeTask" },
      reopenTask: { reopenTask: "stub.todoist.actions.reopenTask" },
    },
  } },
}))

const { AgentDrawer } = await import("@/components/agent/AgentDrawer")
const { AgentDrawerProvider, useAgentDrawer } = await import("@/contexts/AgentDrawerContext")

function Harness() {
  const { open } = useAgentDrawer()
  return <button onClick={() => open("todoist:task:int")}>open</button>
}

describe("agent drawer happy path", () => {
  test("open → transcript + proposal → Execute fires postRun", async () => {
    render(
      <AgentDrawerProvider>
        <Harness />
        <AgentDrawer />
      </AgentDrawerProvider>,
    )

    fireEvent.click(screen.getByText("open"))

    // Auto-trigger fired
    await waitFor(() => {
      expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
        entity_ref: "todoist:task:int",
        message: null,
      }))
    })

    // User message bubble + proposal card render
    expect(await screen.findByText("What should I do?")).toBeInTheDocument()
    expect(screen.getByText("Option A")).toBeInTheDocument()

    // Execute on the recommended option
    postRunMock.mockClear()
    fireEvent.click(screen.getByRole("button", { name: /^Execute$/ }))
    await waitFor(() => {
      expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
        entity_ref: "todoist:task:int",
        message: "EXECUTE: a",
        multitask_strategy: "interrupt",
      }))
    })
  })
})
