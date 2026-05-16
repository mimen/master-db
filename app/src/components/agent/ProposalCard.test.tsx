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

  test("findings list rendered as list items", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getByText("a")).toBeInTheDocument()
    expect(screen.getByText("b")).toBeInTheDocument()
  })
})
