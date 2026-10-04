// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
vi.mock("./AgentSurface", () => ({ AgentSurface: ({ entity_ref }: { entity_ref: string }) => <div data-testid="surface">{entity_ref}</div> }))

import { AgentModeLayout } from "./AgentModeLayout"

describe("AgentModeLayout", () => {
  test("shows AgentSurface for the selected entity_ref", async () => {
    render(<AgentModeLayout selectedEntityRef="todoist:task:b"><div>list</div></AgentModeLayout>)
    expect(await screen.findByTestId("surface")).toHaveTextContent("todoist:task:b")
    expect(screen.getByText("list")).toBeInTheDocument()
  })
  test("empty state when nothing selected", () => {
    render(<AgentModeLayout selectedEntityRef={null}><div>list</div></AgentModeLayout>)
    expect(screen.queryByTestId("surface")).toBeNull()
    expect(screen.getByText(/Select a task/i)).toBeInTheDocument()
  })
})
