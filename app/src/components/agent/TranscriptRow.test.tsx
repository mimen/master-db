// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

import { TranscriptRow } from "./TranscriptRow"

import type { ThreadRow } from "@/lib/agent/convertMessage"

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: vi.fn().mockReturnValue({
    execute: vi.fn(), modify: vi.fn(), send: vi.fn(), interrupt: vi.fn(),
  }),
}))

function row(partial: Partial<ThreadRow>): ThreadRow {
  return { _id: "1", row_type: "message", sequence: 1, run_id: "r", kind: "proposal", ...partial }
}

describe("TranscriptRow", () => {
  test("routes a clarification proposal to ClarificationCard (question shown, no Execute)", () => {
    render(
      <TranscriptRow
        entity_ref="todoist:task:1"
        row={row({
          kind: "proposal",
          proposal_json: {
            kind: "clarification", summary: "s", question: "Who is Watty?",
            options: [], free_text_allowed: true,
          },
        })}
      />,
    )
    expect(screen.getByText("Who is Watty?")).toBeInTheDocument()
    expect(screen.queryByText("Execute")).not.toBeInTheDocument()
  })

  test("routes a normal proposal to ProposalCard (Execute present)", () => {
    render(
      <TranscriptRow
        entity_ref="todoist:task:1"
        row={row({
          kind: "proposal",
          checkpoint_id: "ck",
          proposal_json: {
            kind: "proposal", summary: "s", free_text_allowed: true,
            options: [{ id: "a", label: "A", description: "d", confidence: 0.6, reversibility: "trivial" }],
          },
        })}
      />,
    )
    expect(screen.getAllByText("Execute").length).toBeGreaterThan(0)
  })

  test("renders execution_result body as markdown (backticks → inline code)", () => {
    const { container } = render(
      <TranscriptRow
        entity_ref="todoist:task:1"
        row={row({ kind: "execution_result", body_markdown: "Moved to `Funding`" })}
      />,
    )
    expect(container.querySelector("code")?.textContent).toBe("Funding")
  })
})
