// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { ErrorState } from "./ErrorState"

const retry = vi.fn()
const focus = vi.fn()

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: () => ({ send: vi.fn(), interrupt: vi.fn(), execute: vi.fn(), modify: vi.fn() }),
}))
vi.mock("@/contexts/AgentComposerContext", () => ({
  useAgentComposerHandle: () => ({ focus, startModify: vi.fn() }),
}))

describe("ErrorState", () => {
  test("renders message", () => {
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom" }} onRetry={retry} />)
    expect(screen.getByText("boom")).toBeInTheDocument()
  })

  test("expand details shows JSON", () => {
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom", details: { a: 1 } }} onRetry={retry} />)
    fireEvent.click(screen.getByText(/details/i))
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument()
  })

  test("Retry button fires onRetry", () => {
    retry.mockClear()
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom" }} onRetry={retry} />)
    fireEvent.click(screen.getByText(/retry/i))
    expect(retry).toHaveBeenCalled()
  })

  test("Ask focuses the composer", () => {
    focus.mockClear()
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom" }} onRetry={retry} />)
    fireEvent.click(screen.getByText(/ask the agent/i))
    expect(focus).toHaveBeenCalled()
  })
})
