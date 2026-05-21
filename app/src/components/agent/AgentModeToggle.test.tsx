// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { AgentModeToggle } from "./AgentModeToggle"

describe("AgentModeToggle", () => {
  test("renders both states", () => {
    render(<AgentModeToggle mode="standard" onChange={vi.fn()} />)
    expect(screen.getByRole("button", { name: /standard/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /agent/i })).toBeInTheDocument()
  })

  test("highlights the active state", () => {
    render(<AgentModeToggle mode="agent" onChange={vi.fn()} />)
    const agent = screen.getByRole("button", { name: /agent/i })
    const standard = screen.getByRole("button", { name: /standard/i })
    expect(agent).toHaveAttribute("aria-pressed", "true")
    expect(standard).toHaveAttribute("aria-pressed", "false")
  })

  test("clicking the inactive side emits the new mode", () => {
    const onChange = vi.fn()
    render(<AgentModeToggle mode="standard" onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /agent/i }))
    expect(onChange).toHaveBeenCalledWith("agent")
  })

  test("clicking the active side still emits its mode", () => {
    const onChange = vi.fn()
    render(<AgentModeToggle mode="agent" onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /standard/i }))
    expect(onChange).toHaveBeenCalledWith("standard")
  })
})
