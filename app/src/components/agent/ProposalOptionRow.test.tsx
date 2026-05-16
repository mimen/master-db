// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { ProposalOptionRow } from "./ProposalOptionRow"

import type { ProposalOption } from "@/lib/agent/proposalToParts"

const opt: ProposalOption = {
  id: "b",
  label: "Propose pushing to June 21",
  description: "Reply asking Sarah to move.",
  confidence: 0.85,
  reversibility: "trivial",
  side_effects: ["sends email"],
}

describe("ProposalOptionRow", () => {
  test("renders label + confidence + reversibility + side effects", () => {
    render(<ProposalOptionRow option={opt} recommended={false} onExecute={() => {}} onModify={() => {}} />)
    expect(screen.getByText(opt.label)).toBeInTheDocument()
    expect(screen.getByText(/85%/)).toBeInTheDocument()
    expect(screen.getByText(/trivial/)).toBeInTheDocument()
    expect(screen.getByText(/sends email/)).toBeInTheDocument()
  })

  test("recommended badge appears when recommended=true", () => {
    render(<ProposalOptionRow option={opt} recommended onExecute={() => {}} onModify={() => {}} />)
    expect(screen.getByText(/Recommended/i)).toBeInTheDocument()
  })

  test("Execute click fires onExecute with option id", () => {
    const onExecute = vi.fn()
    render(<ProposalOptionRow option={opt} recommended onExecute={onExecute} onModify={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^Execute$/ }))
    expect(onExecute).toHaveBeenCalledWith("b")
  })

  test("Modify click fires onModify with option id", () => {
    const onModify = vi.fn()
    render(<ProposalOptionRow option={opt} recommended={false} onExecute={() => {}} onModify={onModify} />)
    fireEvent.click(screen.getByRole("button", { name: /Modify/i }))
    expect(onModify).toHaveBeenCalledWith("b")
  })
})
