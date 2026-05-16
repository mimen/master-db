import { describe, expect, test } from "vitest"

import { stripProposalTags } from "./stripProposalTags"

describe("stripProposalTags", () => {
  test("strips <proposal>...</proposal> block", () => {
    const input = 'Some prose.\n\n<proposal>{"kind":"proposal","summary":"do stuff"}</proposal>\n\nMore prose.'
    const result = stripProposalTags(input)
    expect(result).not.toContain("<proposal>")
    expect(result).not.toContain("</proposal>")
    expect(result).toContain("Some prose.")
    expect(result).toContain("More prose.")
  })

  test("strips <execution_result>...</execution_result> block", () => {
    const input = "Before.\n\n<execution_result>done: true</execution_result>\n\nAfter."
    const result = stripProposalTags(input)
    expect(result).not.toContain("<execution_result>")
    expect(result).not.toContain("done: true")
    expect(result).toContain("Before.")
    expect(result).toContain("After.")
  })

  test("preserves prose around tags and collapses excessive blank lines", () => {
    const input = "Line one.\n\n\n\n<clarification>ask user</clarification>\n\n\n\nLine two."
    const result = stripProposalTags(input)
    expect(result).toBe("Line one.\n\nLine two.")
  })

  test("handles multiline JSON payload inside tags", () => {
    const payload = `<blocked>
{
  "kind": "blocked",
  "reason": "need input",
  "options": [1, 2, 3]
}
</blocked>`
    const input = `Intro.\n\n${payload}\n\nOutro.`
    const result = stripProposalTags(input)
    expect(result).toBe("Intro.\n\nOutro.")
  })
})
