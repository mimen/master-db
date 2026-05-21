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
})
