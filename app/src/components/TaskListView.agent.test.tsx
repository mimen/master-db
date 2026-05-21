// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactElement, ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"
import { Router } from "wouter"
import { memoryLocation } from "wouter/memory-location"

import { TaskListView } from "@/components/TaskListView"
import { CountProvider } from "@/contexts/CountContext"
import { DialogProvider } from "@/contexts/DialogContext"
import { HeaderSlotProvider } from "@/contexts/HeaderSlotContext"
import type { ListInstance, ViewParams } from "@/lib/views/types"

const tasks = [
  { _id: "doc_a", todoist_id: "a", content: "First task", priority: 1, due: null, deadline: null, project: null, labels: [], checked: false, child_order: 0 },
  { _id: "doc_b", todoist_id: "b", content: "Second task", priority: 1, due: null, deadline: null, project: null, labels: [], checked: false, child_order: 1 },
]

const overlay = {
  "todoist:task:a": { hasRun: true, status: "awaiting_decision", last_urgency: 0.9, last_chatted_at: 100 },
}

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown, args: unknown) => {
    const name = String(fn)
    // The overlay query is identified by its arg shape ({ entity_refs }) since
    // the api proxy collapses the path to its "default" leaf.
    if (args === "skip") return undefined
    if (args && typeof args === "object" && "entity_refs" in (args as object)) {
      return overlay
    }
    if (name.includes("getItemsByViewWithProjects")) return tasks
    // projects / labels / projectsWithMetadata
    return []
  },
  useAction: () => vi.fn().mockResolvedValue({ accepted: true }),
}))

// The component tree (TaskListItem and friends) reads many api.* paths at module
// load time. Resolve any path lazily to a string whose value is the leaf name so
// the convex/react useQuery mock can match by name (e.g. "getItemsByViewWithProjects").
function apiProxy(name = "api"): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive || prop === "toString") return () => name
        return apiProxy(typeof prop === "string" ? prop : name)
      },
    },
  )
}
vi.mock("@/convex/_generated/api", () => ({ api: apiProxy() }))

// Keep the real BaseListView (it hosts the rows + is wrapped by AgentModeLayout),
// but stub TaskListItem so the test doesn't need TaskListItem's deep provider chain.
// The stub renders the task content and forwards the onClick selection wiring.
vi.mock("@/components/list-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/list-items")>()
  return {
    ...actual,
    TaskListItem: ({ task, onClick }: { task: { content: string }; onClick: () => void }) => (
      <button type="button" onClick={onClick}>
        {task.content}
      </button>
    ),
  }
})

// Stub the agent surface so we can assert the right pane reflects selection.
vi.mock("@/components/agent/AgentSurface", () => ({
  AgentSurface: ({ entity_ref }: { entity_ref: string }) => (
    <div data-testid="agent-surface">{entity_ref}</div>
  ),
}))

// Stub the bulk runner (it does its own convex/auth wiring we don't care about here).
vi.mock("@/components/agent/RunAgentOnListButton", () => ({
  RunAgentOnListButton: () => null,
}))

function makeList(): ListInstance<ViewParams> {
  return {
    id: "list-1",
    viewKey: "view:today",
    indexInView: 0,
    definition: {} as ListInstance<ViewParams>["definition"],
    params: {} as ViewParams,
    query: { type: "time", range: "today", view: "view:today" },
    collapsible: false,
    startExpanded: true,
    dependencies: {} as ListInstance<ViewParams>["dependencies"],
    getHeader: () => ({ title: "Today" }),
    getEmptyState: () => ({ title: "Nothing" }),
  }
}

/** Render inside a wouter Router seeded at the given path (incl. ?status=). */
function renderAt(ui: ReactElement, path = "/agent") {
  const { hook, searchHook } = memoryLocation({ path })
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <Providers>{ui}</Providers>
    </Router>,
  )
}

function renderAgentMode(path = "/agent") {
  return renderAt(<TaskListView list={makeList()} focusedEntityId={null} agentMode />, path)
}

/** Render WITHOUT the agentMode prop — agent mode is driven by the URL only. */
function renderUrlDriven(path = "/today") {
  return renderAt(<TaskListView list={makeList()} focusedEntityId={null} />, path)
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <CountProvider>
      <HeaderSlotProvider>
        <DialogProvider>{children}</DialogProvider>
      </HeaderSlotProvider>
    </CountProvider>
  )
}

describe("TaskListView agent mode", () => {
  test("default all-open filter shows only open-run tasks, hides no-run", async () => {
    // Task "a" has an open (awaiting_decision) run; "b" has no overlay (no-run).
    // Default filter is "all-open" -> only "a" is visible.
    renderAgentMode()
    expect(await screen.findByText("First task")).toBeInTheDocument()
    expect(screen.queryByText("Second task")).toBeNull()
  })

  test("No run filter shows only tasks without an agentic run", async () => {
    renderAgentMode("/agent?status=no-run")
    expect(await screen.findByText("Second task")).toBeInTheDocument()
    expect(screen.queryByText("First task")).toBeNull()
  })

  test("clicking the No run chip switches the filter", async () => {
    renderAgentMode()
    await screen.findByText("First task")
    fireEvent.click(screen.getByText("No run"))
    expect(await screen.findByText("Second task")).toBeInTheDocument()
    expect(screen.queryByText("First task")).toBeNull()
  })

  test("two-pane layout present with empty right pane initially", async () => {
    renderAgentMode()
    await screen.findByText("First task")
    // No selection yet -> surface absent, empty-state copy shown.
    expect(screen.queryByTestId("agent-surface")).toBeNull()
    expect(screen.getByText(/Select a task/i)).toBeInTheDocument()
  })

  test("clicking a row selects it into the right pane", async () => {
    renderAgentMode()
    const row = await screen.findByText("First task")
    fireEvent.click(row)
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
    })
  })

  test("pressing j selects the first displayed task; Escape clears it", async () => {
    // Default all-open filter shows only task "a" (the open run).
    renderAgentMode()
    await screen.findByText("First task")
    expect(screen.queryByTestId("agent-surface")).toBeNull()

    // j with nothing selected -> select the first displayed task.
    fireEvent.keyDown(window, { key: "j" })
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
    })

    // Escape clears the selection -> right pane reverts to the empty state.
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => {
      expect(screen.queryByTestId("agent-surface")).toBeNull()
    })
    expect(screen.getByText(/Select a task/i)).toBeInTheDocument()
  })

  test("j/k clamp at the boundaries of the displayed order", async () => {
    // The all-open filter shows a single open-run task ("a"). j selects it, and
    // repeated j/k clamp at that single-item boundary rather than wrapping.
    renderAgentMode("/agent?status=all-open")
    await screen.findByText("First task")

    fireEvent.keyDown(window, { key: "j" })
    await waitFor(() => {
      expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
    })
    // j again clamps at the last item (still "a").
    fireEvent.keyDown(window, { key: "j" })
    expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
    // k clamps at the first item (still "a").
    fireEvent.keyDown(window, { key: "k" })
    expect(screen.getByTestId("agent-surface")).toHaveTextContent("todoist:task:a")
  })

  test("standard mode does not bind the agent keyboard", async () => {
    // Without agent mode, pressing j must NOT open a right-pane surface (there
    // is no two-pane layout in standard mode at all).
    renderUrlDriven("/today")
    await screen.findByText("First task")
    fireEvent.keyDown(window, { key: "j" })
    expect(screen.queryByTestId("agent-surface")).toBeNull()
  })
})

describe("TaskListView URL-driven mode (no agentMode prop)", () => {
  test("?mode=agent flips a normal list into the two-pane agent layout", async () => {
    renderUrlDriven("/today?mode=agent")
    // Two-pane agent layout: the right-pane empty state is present.
    expect(await screen.findByText(/Select a task/i)).toBeInTheDocument()
  })

  test("without ?mode= a normal list renders standard (no two-pane)", async () => {
    renderUrlDriven("/today")
    // Standard mode: both tasks visible (no agent filter), no right pane.
    expect(await screen.findByText("First task")).toBeInTheDocument()
    expect(screen.getByText("Second task")).toBeInTheDocument()
    expect(screen.queryByText(/Select a task/i)).toBeNull()
    expect(screen.queryByTestId("agent-surface")).toBeNull()
  })
})
