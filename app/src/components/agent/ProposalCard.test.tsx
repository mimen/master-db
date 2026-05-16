// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { ProposalCard } from "./ProposalCard"

import type { Proposal } from "@/lib/agent/proposalToParts"

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: vi.fn().mockReturnValue({
    execute: vi.fn(), modify: vi.fn(), send: vi.fn(), interrupt: vi.fn(),
  }),
}))

const proposal: Proposal = {
  kind: "proposal",
  summary: "summary text",
  findings: ["a", "b"],
  options: [
    { id: "a", label: "A", description: "d", confidence: 0.6, reversibility: "moderate" },
    { id: "b", label: "B", description: "d2", confidence: 0.85, reversibility: "trivial" },
  ],
  recommended_option_id: "b",
  free_text_allowed: true,
}

describe("ProposalCard", () => {
  test("renders summary + findings + all options", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getByText(/summary text/)).toBeInTheDocument()
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.getByText("B")).toBeInTheDocument()
  })

  test("recommended option has badge, other does not", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getAllByText(/Recommended/i)).toHaveLength(1)
  })

  test("findings rendered inside collapsible receipts section", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    // Findings are in the DOM (inside the <details>), accessible to getByText even when collapsed
    expect(screen.getByText("a")).toBeInTheDocument()
    expect(screen.getByText("b")).toBeInTheDocument()
  })

  test("receipts section is collapsed by default (<details> has no open attribute)", () => {
    const { container } = render(
      <ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />
    )
    const detailsEl = container.querySelector("details")
    expect(detailsEl).toBeInTheDocument()
    expect(detailsEl?.hasAttribute("open")).toBe(false)
  })

  test("receipts toggle label shows count", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getByText(/Receipts \(2\)/)).toBeInTheDocument()
  })

  test("decision section header shows option count", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getByText(/Decision · 2 options/)).toBeInTheDocument()
  })

  test("renders nothing in urgency slot when urgency is undefined", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.queryByTestId("urgency-pill")).not.toBeInTheDocument()
    expect(screen.queryByTestId("urgency-block")).not.toBeInTheDocument()
  })

  test("renders urgency pill + reasoning when present", () => {
    const withUrgency: Proposal = {
      ...proposal,
      urgency: 0.9,
      urgency_reasoning: "due tomorrow",
    }
    render(<ProposalCard entity_ref="todoist:task:1" proposal={withUrgency} checkpoint_id="ck1" />)
    const pill = screen.getByTestId("urgency-pill")
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(/0\.90/)
    expect(screen.getByText("due tomorrow")).toBeInTheDocument()
  })

  test("urgency >= 0.85 tints rose", () => {
    const high: Proposal = { ...proposal, urgency: 0.9 }
    render(<ProposalCard entity_ref="todoist:task:1" proposal={high} checkpoint_id="ck1" />)
    expect(screen.getByTestId("urgency-pill").className).toMatch(/rose/)
  })

  test("urgency in 0.5..0.85 tints amber", () => {
    const mid: Proposal = { ...proposal, urgency: 0.6 }
    render(<ProposalCard entity_ref="todoist:task:1" proposal={mid} checkpoint_id="ck1" />)
    expect(screen.getByTestId("urgency-pill").className).toMatch(/amber/)
  })

  test("urgency < 0.5 tints muted (no rose/amber)", () => {
    const low: Proposal = { ...proposal, urgency: 0.2 }
    render(<ProposalCard entity_ref="todoist:task:1" proposal={low} checkpoint_id="ck1" />)
    const cls = screen.getByTestId("urgency-pill").className
    expect(cls).toMatch(/muted/)
    expect(cls).not.toMatch(/rose/)
    expect(cls).not.toMatch(/amber/)
  })

  test("renders pill without reasoning when reasoning omitted", () => {
    const noReason: Proposal = { ...proposal, urgency: 0.4 }
    render(<ProposalCard entity_ref="todoist:task:1" proposal={noReason} checkpoint_id="ck1" />)
    expect(screen.getByTestId("urgency-pill")).toBeInTheDocument()
    // No reasoning text should be present
    expect(screen.queryByText(/due tomorrow/)).not.toBeInTheDocument()
  })
})
