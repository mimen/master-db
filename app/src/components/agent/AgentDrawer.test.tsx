// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { AgentDrawer } from "./AgentDrawer"
import { AgentDrawerProvider, useAgentDrawer } from "@/contexts/AgentDrawerContext"

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
