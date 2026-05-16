// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { ToolCallCard } from "./ToolCallCard"

describe("ToolCallCard", () => {
  test("renders tool name + status", () => {
    render(<ToolCallCard name="search_obsidian" status="ok" input={{ q: "x" }} output={{ hits: 2 }} />)
    expect(screen.getByText("search_obsidian")).toBeInTheDocument()
    expect(screen.getByText("ok")).toBeInTheDocument()
  })

  test("collapsed by default; click expands", () => {
    render(<ToolCallCard name="Read" status="ok" input={{ path: "/x" }} output={{ content: "hi" }} />)
    expect(screen.queryByText(/path/)).toBeNull()
    fireEvent.click(screen.getByText("Read"))
    expect(screen.getByText(/path/)).toBeInTheDocument()
  })

  test("pending state shows distinct affordance", () => {
    render(<ToolCallCard name="Bash" status="pending" input={{}} output={null} />)
    expect(screen.getByText("pending")).toBeInTheDocument()
  })
})
