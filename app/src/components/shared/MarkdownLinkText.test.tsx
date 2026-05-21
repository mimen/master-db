// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { MarkdownLinkText } from "./MarkdownLinkText"

describe("MarkdownLinkText", () => {
  test("renders plain text without an anchor", () => {
    render(<MarkdownLinkText text="Just a plain title" />)
    expect(screen.getByText("Just a plain title")).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
  })

  test("renders a markdown link as an anchor with href + text", () => {
    render(<MarkdownLinkText text="[Dropbox](https://dropbox.com/x)" />)
    const link = screen.getByRole("link", { name: "Dropbox" })
    expect(link).toHaveAttribute("href", "https://dropbox.com/x")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  test("renders mixed text + link", () => {
    render(<MarkdownLinkText text="See [doc](https://x.com) now" />)
    expect(screen.getByText(/See/)).toBeInTheDocument()
    expect(screen.getByText(/now/)).toBeInTheDocument()
    const link = screen.getByRole("link", { name: "doc" })
    expect(link).toHaveAttribute("href", "https://x.com")
  })

  test("link click does not propagate to ancestor handlers", () => {
    const onClick = vi.fn()
    render(
      <button type="button" onClick={onClick}>
        <MarkdownLinkText text="[doc](https://x.com)" />
      </button>,
    )
    fireEvent.click(screen.getByRole("link", { name: "doc" }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
