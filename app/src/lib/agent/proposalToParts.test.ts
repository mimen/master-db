import { describe, expect, test } from "vitest"

import { isProposal, type Proposal } from "./proposalToParts"

const validProposal: Proposal = {
  kind: "proposal",
  summary: "x",
  options: [
    { id: "a", label: "A", description: "d", confidence: 0.5, reversibility: "trivial" },
  ],
  free_text_allowed: true,
}

describe("isProposal", () => {
  test("accepts a minimal proposal", () => {
    expect(isProposal(validProposal)).toBe(true)
  })

  test("rejects null", () => {
    expect(isProposal(null)).toBe(false)
  })

  test("rejects missing kind", () => {
    expect(isProposal({ ...validProposal, kind: undefined })).toBe(false)
  })

  test("rejects unknown kind", () => {
    expect(isProposal({ ...validProposal, kind: "garbage" })).toBe(false)
  })

  test("rejects non-array options", () => {
    expect(isProposal({ ...validProposal, options: "nope" })).toBe(false)
  })

  test("rejects option missing required field", () => {
    expect(isProposal({
      ...validProposal,
      options: [{ id: "a", label: "A" }],
    })).toBe(false)
  })

  test("accepts a clarification with question", () => {
    expect(isProposal({
      kind: "clarification",
      summary: "?",
      question: "Which?",
      options: [],
      free_text_allowed: true,
    })).toBe(true)
  })
})
