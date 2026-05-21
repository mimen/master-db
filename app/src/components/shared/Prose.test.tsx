// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test } from "vitest"

import { Prose } from "./Prose"

describe("Prose", () => {
  test("renders a markdown heading", () => {
    render(<Prose text={"# Hello"} />)
    const heading = screen.getByRole("heading", { name: "Hello" })
    expect(heading.tagName).toBe("H1")
  })

  test("renders a markdown link as an anchor that opens in a new tab safely", () => {
    render(<Prose text={"See [doc](https://x.com)"} />)
    const link = screen.getByRole("link", { name: "doc" })
    expect(link).toHaveAttribute("href", "https://x.com")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  test("renders inline code from backticks", () => {
    const { container } = render(<Prose text={"Moved to `Funding`"} />)
    expect(container.querySelector("code")?.textContent).toBe("Funding")
  })
})
