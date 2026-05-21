// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { useAgentQueueKeybindings } from "./useAgentQueueKeybindings"

function dispatch(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}

describe("useAgentQueueKeybindings", () => {
  test("j fires onNext", () => {
    const onNext = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext, onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("j")
    expect(onNext).toHaveBeenCalledOnce()
  })

  test("ArrowDown also fires onNext", () => {
    const onNext = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext, onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("ArrowDown")
    expect(onNext).toHaveBeenCalledOnce()
  })

  test("k / ArrowUp fire onPrev", () => {
    const onPrev = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev, onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("k")
    dispatch("ArrowUp")
    expect(onPrev).toHaveBeenCalledTimes(2)
  })

  test("1/2/3/4 fire onExecuteOption with the index", () => {
    const onExecuteOption = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption, onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("1"); dispatch("2"); dispatch("3"); dispatch("4")
    expect(onExecuteOption.mock.calls).toEqual([[0], [1], [2], [3]])
  })

  test("m fires onModify", () => {
    const onModify = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify, onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }),
    )
    dispatch("m")
    expect(onModify).toHaveBeenCalledOnce()
  })

  test("e fires onExecuteRecommended", () => {
    const onExecuteRecommended = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended, onClearFocus: vi.fn() }),
    )
    dispatch("e")
    expect(onExecuteRecommended).toHaveBeenCalledOnce()
  })

  test("esc fires onClearFocus", () => {
    const onClearFocus = vi.fn()
    renderHook(() =>
      useAgentQueueKeybindings({ enabled: true, onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus }),
    )
    dispatch("Escape")
    expect(onClearFocus).toHaveBeenCalledOnce()
  })

  test("typing in an input does not fire any binding", () => {
    const cbs = { onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }
    renderHook(() => useAgentQueueKeybindings({ enabled: true, ...cbs }))
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    dispatch("j"); dispatch("1"); dispatch("m")
    document.body.removeChild(input)
    expect(cbs.onNext).not.toHaveBeenCalled()
    expect(cbs.onExecuteOption).not.toHaveBeenCalled()
    expect(cbs.onModify).not.toHaveBeenCalled()
  })

  test("enabled=false suppresses all bindings", () => {
    const cbs = { onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }
    renderHook(() => useAgentQueueKeybindings({ enabled: false, ...cbs }))
    dispatch("j"); dispatch("Escape"); dispatch("1")
    expect(cbs.onNext).not.toHaveBeenCalled()
    expect(cbs.onExecuteOption).not.toHaveBeenCalled()
    expect(cbs.onClearFocus).not.toHaveBeenCalled()
  })

  test("modifier+key (cmd/ctrl/alt) does not fire any binding", () => {
    const cbs = { onNext: vi.fn(), onPrev: vi.fn(), onExecuteOption: vi.fn(), onModify: vi.fn(), onExecuteRecommended: vi.fn(), onClearFocus: vi.fn() }
    renderHook(() => useAgentQueueKeybindings({ enabled: true, ...cbs }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", metaKey: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", altKey: true, bubbles: true }))
    expect(cbs.onExecuteOption).not.toHaveBeenCalled()
    expect(cbs.onNext).not.toHaveBeenCalled()
    expect(cbs.onExecuteRecommended).not.toHaveBeenCalled()
  })
})
