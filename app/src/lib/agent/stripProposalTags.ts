// Strips inline <proposal>...</proposal>, <execution_result>...</execution_result>,
// <clarification>...</clarification>, <blocked>...</blocked> blocks from prose.
// Used as a client-side workaround for an engine-side parsing bug.
const TAGS = ["proposal", "execution_result", "clarification", "blocked"]

export function stripProposalTags(md: string): string {
  let out = md
  for (const t of TAGS) {
    const re = new RegExp(`<${t}>[\\s\\S]*?</${t}>`, "g")
    out = out.replace(re, "")
  }
  return out.replace(/\n{3,}/g, "\n\n").trim()
}
