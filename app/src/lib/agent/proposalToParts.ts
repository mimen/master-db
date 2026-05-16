export type ReversibilityLevel = "trivial" | "moderate" | "destructive"

export type ProposalOption = {
  id: string
  label: string
  description: string
  rationale?: string
  confidence: number
  reversibility: ReversibilityLevel
  side_effects?: string[]
}

export type Proposal = {
  kind: "clarification" | "proposal" | "execution_result" | "blocked"
  summary: string
  findings?: string[]
  options: ProposalOption[]
  recommended_option_id?: string
  free_text_allowed: boolean
  question?: string
  urgency?: number
  urgency_reasoning?: string
}

const PROPOSAL_KINDS = new Set(["clarification", "proposal", "execution_result", "blocked"])
const REVERSIBILITY = new Set(["trivial", "moderate", "destructive"])

function isOption(v: unknown): v is ProposalOption {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.description === "string" &&
    typeof o.confidence === "number" &&
    typeof o.reversibility === "string" &&
    REVERSIBILITY.has(o.reversibility as string)
  )
}

export function isProposal(v: unknown): v is Proposal {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  if (o.urgency !== undefined && typeof o.urgency !== "number") return false
  if (o.urgency_reasoning !== undefined && typeof o.urgency_reasoning !== "string")
    return false
  return (
    typeof o.kind === "string" &&
    PROPOSAL_KINDS.has(o.kind) &&
    typeof o.summary === "string" &&
    typeof o.free_text_allowed === "boolean" &&
    Array.isArray(o.options) &&
    (o.options as unknown[]).every(isOption)
  )
}
