// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { TaskCompleteCircle } from "./TaskCompleteCircle"

describe("TaskCompleteCircle", () => {
  test("renders a button and calls onToggle when clicked", () => {
    const onToggle = vi.fn()
    render(<TaskCompleteCircle onToggle={onToggle} />)

    const button = screen.getByRole("button")
    expect(button).toBeTruthy()

    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test("checked renders the completed look (filled + pressed)", () => {
    render(<TaskCompleteCircle checked onToggle={vi.fn()} />)

    const button = screen.getByRole("button")
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(button.className).toContain("bg-current")
  })

  test("unchecked does not set aria-pressed", () => {
    render(<TaskCompleteCircle onToggle={vi.fn()} />)

    const button = screen.getByRole("button")
    expect(button.getAttribute("aria-pressed")).toBeNull()
    expect(button.className).not.toContain("bg-current")
  })

  test("priorityColorClass applies its color class", () => {
    render(<TaskCompleteCircle priorityColorClass="text-red-500" onToggle={vi.fn()} />)

    const button = screen.getByRole("button")
    expect(button.className).toContain("text-red-500")
    expect(button.className).toContain("border-red-500/60")
  })

  test("default (non-routine) variant uses the 17px size classes", () => {
    render(<TaskCompleteCircle onToggle={vi.fn()} />)

    const button = screen.getByRole("button")
    expect(button.className).toContain("h-[17px]")
    expect(button.className).toContain("w-[17px]")
  })

  test("routine variant uses transparent border styling and default aria-label", () => {
    render(<TaskCompleteCircle isRoutine onToggle={vi.fn()} />)

    const button = screen.getByRole("button")
    expect(button.className).toContain("border-transparent")
    expect(button.getAttribute("aria-label")).toBe("Complete routine task")
  })
})
