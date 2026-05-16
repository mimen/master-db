# Urgency scoring on agent proposals

**Date:** 2026-05-16
**Status:** Sketch — agreed in chat, not yet implemented.
**Why now:** Burndown queue (Phase 2) needs to sort proposals by something better than `updated_at`. Real ask is "show me what's most urgent first." Milad's framing: a global urgency score, the agent's own estimate of how urgent its decision is. "We haven't found that yet, but it would be pretty fire if someone had that."

## Concrete shape

Add a proposal-level urgency to the existing `Proposal` schema:

```ts
type Proposal = {
  kind: "clarification" | "proposal" | "execution_result" | "blocked"
  summary: string
  findings?: string[]
  options: ProposalOption[]
  recommended_option_id?: string
  free_text_allowed: boolean
  question?: string

  // NEW:
  urgency?: number              // 0..1 — the agent's own estimate of how
                                // urgent this decision is. Higher = more
                                // urgent. Optional during rollout; required
                                // once stable.
  urgency_reasoning?: string    // Optional one-sentence rationale ("due
                                // tomorrow", "depends on time-sensitive
                                // external party", "no time pressure")
                                // — for surfacing in the UI on hover and
                                // for debugging miscalibrated scores.
}
```

Proposal-level, not per-option. The decision as a whole has an urgency; each option doesn't get its own.

## Touchpoints

1. **Engine — schema:** `engine/src/runner/proposalSchema.ts` zod includes `urgency` (0..1) and `urgency_reasoning` (string), both optional.
2. **Engine — prompt:** Claude Agent SDK system prompt instructs the agent to emit `urgency` on every proposal. Anchor language: "0 = no time pressure, can sit indefinitely; 0.5 = should decide this week; 0.9 = should decide today; 1.0 = blocking active work right now."
3. **Convex — schema:** `agenticRuns` gets a denormalized `last_urgency: number | null` field so the queue can sort via an index without joining into `agenticThreadMessages`.
4. **Convex — mutations:** `updateRunStatus` (or wherever the run row is patched when a proposal lands) copies `proposal_json.urgency → last_urgency`.
5. **Convex — index:** new `by_status_and_urgency` on `agenticRuns` for the burndown query.
6. **Client — display:** `AgentStatusBadge` could show urgency tint (subtle: bg-rose for high, no tint for low). `ProposalCard` shows urgency + reasoning near the title.
7. **Client — queue (Phase 2):** burndown sorted by `urgency desc, updated_at desc`. Tiebreak on age so old-but-not-urgent items don't get stuck.

## Calibration concerns

- **Anchor scale will drift.** Without clear anchors in the prompt, the agent will collapse to 0.6–0.8 for everything. Use specific examples in the prompt and re-tune after collecting ~50 real proposals.
- **Compare against task metadata.** Once we have data: for each proposal, compare `urgency` to the task's `priority`, `due_date`, `deadline`. If `urgency = 0.9` but the task is P4 with no due date, the agent's wrong about something — interesting signal.
- **User feedback loop.** Eventually let the user thumbs-up / thumbs-down the urgency assessment to fine-tune. Out of scope for v1.

## Rollout

**Phase A — start collecting (now):**
- Add `urgency` to the zod schema, optional.
- Update the SDK prompt to request urgency on every proposal.
- Denormalize to `agenticRuns.last_urgency` so we accumulate data on every existing run.
- No UI changes yet. Just collect.

**Phase B — surface (when Phase 2 burndown lands):**
- Sort burndown by urgency desc.
- Display urgency in ProposalCard + maybe AgentStatusBadge.

**Phase C — tune & feedback (after ~50 real proposals):**
- Re-anchor the prompt based on observed distribution.
- Optional user feedback widget on each proposal.

## Open question

Should the agent's urgency consider just the task's own time-pressure, or also factor in opportunity cost (Milad's time is finite, this isn't the most valuable decision he could be making right now)? Probably just task-level for now. Opportunity-cost ranking is a separate "what should I do next" problem that needs cross-entity reasoning.

## Cross-references

- Spec section "Future phases — Phase 2 (burndown queue route)" in `docs/superpowers/specs/2026-05-15-agentic-engine-ux-design.md` — that's where this lands UX-side.
- `engine/src/runner/proposalSchema.ts` — current Proposal zod, no urgency field yet.
- `convex/schema/agentic/agenticRuns.ts` — current schema, no `last_urgency` field yet.
