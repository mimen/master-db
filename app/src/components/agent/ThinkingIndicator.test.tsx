// @vitest-environment jsdom
import { render, act } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { ThinkingIndicator } from "./ThinkingIndicator"

describe("ThinkingIndicator", () => {
  test("renders 3 dots", () => {
    const { container } = render(<ThinkingIndicator startedAt={Date.now()} />)
    expect(container.querySelectorAll(".rounded-full")).toHaveLength(3)
  })

  test("elapsed timer text updates via direct DOM mutation (not React state)", () => {
    vi.useFakeTimers()
    const start = Date.now()
    const { container } = render(<ThinkingIndicator startedAt={start} />)
    const node = container.querySelector('[data-testid="elapsed"]') as HTMLElement
    const before = node.textContent
    act(() => vi.advanceTimersByTime(3000))
    expect(node.textContent).not.toBe(before)
    vi.useRealTimers()
  })
})
