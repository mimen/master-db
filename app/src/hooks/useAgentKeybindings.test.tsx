// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useAgentKeybindings } from "./useAgentKeybindings"

describe("useAgentKeybindings", () => {
  test("g then a within 500ms fires openForActiveTask", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: true, openForActiveTask: opener }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    expect(opener).toHaveBeenCalledOnce()
  })

  test("g alone does nothing", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: true, openForActiveTask: opener }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }))
    expect(opener).not.toHaveBeenCalled()
  })

  test("when typing in an input, g a does NOT fire", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: true, openForActiveTask: opener }))
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
    document.body.removeChild(input)
    expect(opener).not.toHaveBeenCalled()
  })

  test("enabled=false → no binding", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: false, openForActiveTask: opener }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    expect(opener).not.toHaveBeenCalled()
  })
})
