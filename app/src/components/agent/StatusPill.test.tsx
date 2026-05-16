// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { StatusPill } from "./StatusPill"

describe("StatusPill", () => {
  test("renders Thinking with pulse for discovering", () => {
    const { container } = render(<StatusPill status="discovering" />)
    expect(screen.getByText("Thinking")).toBeInTheDocument()
    expect(container.querySelector(".animate-pulse")).toBeTruthy()
  })

  test("renders Awaiting you for awaiting_decision (no pulse)", () => {
    const { container } = render(<StatusPill status="awaiting_decision" />)
    expect(screen.getByText("Awaiting you")).toBeInTheDocument()
    expect(container.querySelector(".animate-pulse")).toBeNull()
  })

  test("renders Error for error", () => {
    render(<StatusPill status="error" />)
    expect(screen.getByText("Error")).toBeInTheDocument()
  })

  test("renders Idle for idle", () => {
    render(<StatusPill status="idle" />)
    expect(screen.getByText("Idle")).toBeInTheDocument()
  })
})
