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
