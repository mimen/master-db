# Markdown receipt + "Ask X" → clarification fix — Design (2026-05-20)

Roadmap item 1 (`docs/agentic-engine/2026-05-16-roadmap.md`). Closes two daily-visible
surface bugs identified in the corpus eval (`docs/agentic-engine/2026-05-16-corpus-eval.md`):
the "Ask X" anti-pattern and conflated/raw rendering.

## Context: what's already done

A parallel UX-agent already wired `react-markdown` + `remark-gfm` into the two main
render sites — the assistant-message `Prose` component and the `ProposalCard` summary
(both in `app/src/components/agent/`). `react-markdown` and `remark-gfm` are already in
`app/package.json`. So the "markdown rendering" half of the roadmap item is mostly shipped.

The data path for clarifications already works end-to-end: `proposalSchema.ts` and the
frontend `Proposal` type (`app/src/lib/agent/proposalToParts.ts`) both carry
`kind: "clarification"` and an optional `question`. The runner persists the full proposal
object as `proposal_json`. Two clarifications already exist in the corpus. **No schema or
event-shape changes are needed.**

## Problem

1. **Engine over-uses `kind: "proposal"`.** When the agent needs context only the user has,
   it emits a `proposal` with an option labeled "Ask: who is Watty?" — the user asking the
   user. Seven such instances in the corpus. The system prompt describes `clarification`
   semantics but does not forbid the "Ask X" shape or show examples.

2. **Frontend renders every terminal the same.** `AgentTranscript` routes all `proposal`
   rows to `ProposalCard`, which shows Execute/Modify buttons, confidence, and reversibility
   on what — for a clarification — are really *suggested answers to a question*. The
   `question` field never surfaces.

3. **`execution_result` receipt renders raw text.** The emerald receipt card prints
   `stripProposalTags(body_markdown)` literally; backticks/lists in agent-authored receipts
   show as source.

## Scope

Three changes. No schema migration, no Convex function changes, no engine event-shape
changes.

### 1. Engine — tighten `DEFAULT_SYSTEM` (`engine/src/runner/claudeSdkRunner.ts`)

In the "Kind semantics" block, add an explicit rule plus worked examples:

- **Rule:** when you need information that only the user can provide (who a person is,
  which of two ambiguous referents, a missing preference), emit `kind: "clarification"`
  with a populated `question`, `free_text_allowed: true`, and `options` as *candidate
  answers*. Do **not** emit a `proposal` whose option is labeled "Ask Milad" / "Ask: who is
  X" when X is the user.
- **BAD example:** `kind:"proposal"`, options include `{ "label": "Ask: who is Watty?" }`.
- **GOOD example:** `kind:"clarification"`, `question:"Who is Watty — which person/entity
  does this refer to?"`, options are concrete candidate answers (e.g. "An investor",
  "An artist I'm booking"), `free_text_allowed:true`.
- **Preserve genuinely external asks as proposals.** "Ask Jacob via Slack" / "Ask Sarah to
  clarify her preference" *perform an external send* — those stay `kind:"proposal"` actions.
  The distinction is: asking the *user who is operating the drawer* = clarification; asking a
  *third party via a tool* = proposal action.

This is a prompt-string edit only. There is no behavioral unit test for model output; it is
verified behaviorally (see Verification).

### 2. Frontend — distinct clarification rendering

- **`AgentTranscript.tsx`:** in the `r.kind === "proposal"` branch, inspect
  `r.proposal_json.kind`. If `=== "clarification"`, render a new `ClarificationCard`;
  otherwise render the existing `ProposalCard` unchanged.
- **New `ClarificationCard.tsx`** (`app/src/components/agent/`):
  - Renders `proposal.question` prominently (heading-weight). Falls back to `summary` if
    `question` is somehow absent.
  - Renders `proposal.summary` as markdown context (reuse the `Prose`/markdown pattern) when
    it adds detail beyond the question.
  - A one-line hint — "Type your answer below, or pick a common one:" — and on mount calls
    the existing composer handle's `focus()` (`useAgentComposerHandle()` from
    `AgentComposerContext`) so the text input is the primary affordance.
  - Suggested-answer chips from `proposal.options`, framed as "common answers" (buttons,
    visually lighter than proposal options). **Chip click → `send(option.label)`** (the
    free-text answer path from `useAgentPost`), NOT `execute()`. The label text becomes the
    user's reply; the agent re-discovers and follows up.
  - **Omitted by design:** Execute button, Modify button, confidence/reversibility badges,
    `recommended_option_id` ★, RewindButton. Those are proposal-action affordances; a
    question has nothing to execute.

### 3. Frontend — `execution_result` receipt renders markdown

In `AgentTranscript.tsx`, the `execution_result` branch keeps the emerald card and `✓`
prefix but renders the stripped body through the existing `Prose` component instead of raw
interpolation. `user_message` bubbles stay raw (literal user input — intentional).

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `DEFAULT_SYSTEM` (engine) | Instruct the model to choose `clarification` correctly | nothing (string) |
| `AgentTranscript` | Route a row to the right card by `proposal_json.kind`; render receipts as markdown | `ClarificationCard`, `ProposalCard`, `Prose` |
| `ClarificationCard` (new) | Render a question + answer chips + free-text affordance | `useAgentPost.send`, `useAgentComposerHandle.focus`, markdown `Prose` |
| `ProposalCard` | Unchanged | — |

`ClarificationCard` is independently testable: given a `Proposal` with `kind:"clarification"`,
it renders the question and chips and calls `send` with the chip label on click.

## Testing

- **`ClarificationCard.test.tsx`** (new): renders `question`; renders one chip per option;
  clicking a chip calls `send` with that option's `label`; asserts no "Execute" button is
  present (distinguishes it from `ProposalCard`).
- **`AgentTranscript` test** (extend existing or add): a row whose `proposal_json.kind ===
  "clarification"` renders `ClarificationCard` (question text present), and a
  `kind:"proposal"` row still renders `ProposalCard` (Execute present). An `execution_result`
  row renders markdown (e.g. an inline-code element from a backticked body).
- Gate: `bun run test` shows no new failures beyond the pre-existing baseline (convex
  `agentic/{mutations,queries}` auth `Unauthorized` + `app/src/auth/SignInScreen.test.tsx`,
  which fail on `main` too). `bun run typecheck` / `bun run lint` introduce no new errors in
  touched files.

## Verification (behavioral)

1. Build the app; open a thread that already contains a clarification (corpus has 2) — the
   question renders prominently, chips appear as "common answers", the composer is focused,
   clicking a chip sends its label as a reply.
2. Open an executed thread — the receipt renders markdown (backticks → inline code).
3. Reload the engine on the Mac mini:
   `launchctl kickstart -k gui/$(id -u)/com.milad.agentic-engine`.
4. Re-trigger discovery on a known "Ask X" entity (watty investor / alex's mailbox); confirm
   the new terminal is `kind:"clarification"` with a `question`. Run
   `bunx convex run 'agentic/queries/_adminDigest:default'` and confirm new conversations
   show clarifications rather than "Ask X" proposals.

## Out of scope

- Receipt/follow-up split and auto-chain after EXECUTE (roadmap item 2).
- Markdown in `user_message` bubbles (literal user input; intentionally raw).
- Any change to the clarification *data model* or the runner's event normalization (the
  runner emits clarification as a `proposal` event carrying `proposal_json.kind`; the
  frontend discriminates — keeping this is the minimal correct design).
