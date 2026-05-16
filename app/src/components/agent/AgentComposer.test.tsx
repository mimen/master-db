// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { type ReactNode } from "react"
import { describe, expect, test, vi } from "vitest"

import { AgentComposer } from "./AgentComposer"

import { AgentComposerProvider } from "@/contexts/AgentComposerContext"

const send = vi.fn().mockResolvedValue({})
const interrupt = vi.fn().mockResolvedValue({})

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: () => ({ send, interrupt, execute: vi.fn(), modify: vi.fn() }),
}))

function wrap(ui: ReactNode) {
  return render(<AgentComposerProvider>{ui}</AgentComposerProvider>)
}

describe("AgentComposer", () => {
  test("renders Send by default", () => {
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning={false} />)
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
  })

  test("Cmd+Enter sends typed text", () => {
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning={false} />)
    const ta = screen.getByRole("textbox")
    fireEvent.change(ta, { target: { value: "hello" } })
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true })
    expect(send).toHaveBeenCalledWith("hello")
  })

  test("empty Cmd+Enter is a no-op", () => {
    send.mockClear()
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning={false} />)
    const ta = screen.getByRole("textbox")
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true })
    expect(send).not.toHaveBeenCalled()
  })

  test("when isRunning=true, Stop replaces Send and fires interrupt", () => {
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning />)
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    expect(interrupt).toHaveBeenCalled()
  })
})
