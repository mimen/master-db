import { z } from "zod";

export const ProposalOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  rationale: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reversibility: z.enum(["trivial", "moderate", "destructive"]),
  side_effects: z.array(z.string()).optional(),
});

export const ProposalSchema = z.object({
  kind: z.enum(["clarification", "proposal", "execution_result", "blocked"]),
  summary: z.string(),
  findings: z.array(z.string()).optional(),
  options: z.array(ProposalOptionSchema),
  recommended_option_id: z.string().optional(),
  free_text_allowed: z.boolean(),
  question: z.string().optional(),
  urgency: z.number().min(0).max(1).optional(),
  urgency_reasoning: z.string().optional(),
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalOption = z.infer<typeof ProposalOptionSchema>;

// Clarification cards always render a "Type my own answer" affordance, so an
// option that just means "let me free-text it" is redundant and confusing.
// The system prompt forbids these, but the model occasionally emits one anyway;
// strip them deterministically as a backend safety net.
const META_OPTION_RE =
  /^(i'?ll\s+(tell|type|explain|specify|let you know)|let me\s+(tell|type|explain|specify)|tell you|other|something else|none(\s+of)?\b|ask me)/i;

export function dropRedundantClarificationOptions(p: Proposal): Proposal {
  if (p.kind !== "clarification") return p;
  const options = p.options.filter((o) => !META_OPTION_RE.test(o.label.trim()));
  return options.length === p.options.length ? p : { ...p, options };
}
