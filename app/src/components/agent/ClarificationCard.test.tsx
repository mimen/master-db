// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { ClarificationCard } from "./ClarificationCard"

import type { Proposal } from "@/lib/agent/proposalToParts"

const sendMock = vi.fn()
vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: vi.fn().mockReturnValue({
    execute: vi.fn(),
    modify: vi.fn(),
    send: (...a: unknown[]) => sendMock(...a),
    interrupt: vi.fn(),
  }),
}))

const focusMock = vi.fn()
vi.mock("@/contexts/AgentComposerContext", () => ({
  useAgentComposerHandle: () => ({ focus: focusMock, startModify: vi.fn() }),
}))

const clarification: Proposal = {
  kind: "clarification",
  summary: "Need to know which Watty.",
  question: "Who is Watty?",
  options: [
    { id: "inv", label: "A potential investor", description: "", confidence: 0.5, reversibility: "trivial" },
    { id: "art", label: "An artist I'm booking", description: "", confidence: 0.5, reversibility: "trivial" },
  ],
  free_text_allowed: true,
}

describe("ClarificationCard", () => {
  beforeEach(() => {
    sendMock.mockClear()
    focusMock.mockClear()
  })

  test("renders the question prominently", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    expect(screen.getByText("Who is Watty?")).toBeInTheDocument()
  })

  test("renders a chip per option", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    expect(screen.getByText("A potential investor")).toBeInTheDocument()
    expect(screen.getByText("An artist I'm booking")).toBeInTheDocument()
  })

  test("clicking a chip sends its label as a free-text answer", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    fireEvent.click(screen.getByText("A potential investor"))
    expect(sendMock).toHaveBeenCalledWith("A potential investor")
  })

  test("renders no Execute button (not a proposal)", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    expect(screen.queryByText("Execute")).not.toBeInTheDocument()
  })

  test("'type my own answer' button focuses the composer and sends nothing", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    fireEvent.click(screen.getByText(/type my own answer/i))
    expect(focusMock).toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
})
