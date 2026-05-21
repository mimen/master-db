# Markdown receipt + "Ask X" → clarification fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render agent clarifications as questions with answer-chips (not Execute/Modify proposal cards), render execution receipts as markdown, and stop the engine emitting "Ask X" proposal options when X is the user.

**Architecture:** Extract the per-row rendering out of `AgentTranscript` into a pure, testable `TranscriptRow` component plus a local `Prose` markdown helper. `TranscriptRow` discriminates on `proposal_json.kind` to route clarifications to a new `ClarificationCard`. Engine change is a system-prompt string edit. No Convex schema, no event-shape, no `proposalSchema` changes — `kind`/`question` already flow end-to-end.

**Tech Stack:** React 19, Vitest + @testing-library/react (jsdom), react-markdown + remark-gfm (already deps), Convex, Claude Agent SDK (engine).

**Spec:** `docs/superpowers/specs/2026-05-20-markdown-and-clarification-fix-design.md`

**Baseline gate:** `bun run test` (vitest) — touched areas must stay green. Pre-existing failures outside scope: convex `agentic/{mutations,queries}` (auth `Unauthorized`) and `app/src/auth/SignInScreen.test.tsx`. Use `command git` for commits (shell wraps `git`→`rtk git`, `cat`→`rtk read`).

---

## File Structure

- Create: `app/src/components/agent/ClarificationCard.tsx` — renders a clarification (question + answer chips + free-text hint).
- Create: `app/src/components/agent/ClarificationCard.test.tsx`
- Create: `app/src/components/agent/TranscriptRow.tsx` — pure single-row renderer (all row kinds); exports `Prose` + `TranscriptRow`.
- Create: `app/src/components/agent/TranscriptRow.test.tsx`
- Modify: `app/src/components/agent/AgentTranscript.tsx` — delegate row rendering to `TranscriptRow`; drop the inline switch, `Prose`, and `ErrorRowWrapper`.
- Modify: `app/src/components/agent/index.ts` — export `ClarificationCard`, `TranscriptRow`.
- Modify: `engine/src/runner/claudeSdkRunner.ts` — `DEFAULT_SYSTEM`: add Ask-X→clarification rule + BAD/GOOD examples.

---

## Task 1: ClarificationCard

**Files:**
- Create: `app/src/components/agent/ClarificationCard.tsx`
- Test: `app/src/components/agent/ClarificationCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { ClarificationCard } from "./ClarificationCard"

import type { Proposal } from "@/lib/agent/proposalToParts"

const sendMock = vi.fn()
vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: vi.fn().mockReturnValue({
    execute: vi.fn(),
    modify: vi.fn(),
    send: (...a: unknown[]) => sendMock(...a),
    interrupt: vi.fn(),
  }),
}))

const clarification: Proposal = {
  kind: "clarification",
  summary: "Need to know which Watty.",
  question: "Who is Watty?",
  options: [
    { id: "inv", label: "A potential investor", description: "", confidence: 0.5, reversibility: "trivial" },
    { id: "art", label: "An artist I'm booking", description: "", confidence: 0.5, reversibility: "trivial" },
  ],
  free_text_allowed: true,
}

describe("ClarificationCard", () => {
  beforeEach(() => sendMock.mockClear())

  test("renders the question prominently", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    expect(screen.getByText("Who is Watty?")).toBeInTheDocument()
  })

  test("renders a chip per option", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    expect(screen.getByText("A potential investor")).toBeInTheDocument()
    expect(screen.getByText("An artist I'm booking")).toBeInTheDocument()
  })

  test("clicking a chip sends its label as a free-text answer", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    fireEvent.click(screen.getByText("A potential investor"))
    expect(sendMock).toHaveBeenCalledWith("A potential investor")
  })

  test("renders no Execute button (not a proposal)", () => {
    render(<ClarificationCard entity_ref="todoist:task:1" proposal={clarification} />)
    expect(screen.queryByText("Execute")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test app/src/components/agent/ClarificationCard.test.tsx`
Expected: FAIL — `Cannot find module './ClarificationCard'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Button } from "@/components/ui/button"
import { useAgentComposerHandle } from "@/contexts/AgentComposerContext"
import { useAgentPost } from "@/hooks/useAgentPost"
import type { Proposal } from "@/lib/agent/proposalToParts"

type Props = {
  entity_ref: string
  proposal: Proposal
}

export function ClarificationCard({ entity_ref, proposal }: Props) {
  const { send } = useAgentPost(entity_ref)
  const composer = useAgentComposerHandle()

  // Make the free-text composer the primary affordance: focus it when a
  // clarification appears. No-op if the composer hasn't registered yet.
  useEffect(() => {
    composer?.focus()
  }, [composer])

  const question = proposal.question ?? proposal.summary
  const showSummary = proposal.summary !== "" && proposal.summary !== question

  return (
    <div
      className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-4 space-y-3"
      data-testid="clarification-card"
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">
        Needs your input
      </div>
      <h3 className="text-base font-semibold leading-snug">{question}</h3>

      {showSummary && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.summary}</ReactMarkdown>
        </div>
      )}

      {proposal.options.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Common answers
          </div>
          <div className="flex flex-wrap gap-2">
            {proposal.options.map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant="outline"
                className="h-auto py-1"
                onClick={() => void send(o.label)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Type your answer below, or pick a common one.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test app/src/components/agent/ClarificationCard.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
command git add app/src/components/agent/ClarificationCard.tsx app/src/components/agent/ClarificationCard.test.tsx
command git commit -m "feat(agent): ClarificationCard — question + answer chips, free-text primary"
```

---

## Task 2: TranscriptRow (extract + route clarifications + markdown receipt)

**Files:**
- Create: `app/src/components/agent/TranscriptRow.tsx`
- Test: `app/src/components/agent/TranscriptRow.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test app/src/components/agent/TranscriptRow.test.tsx`
Expected: FAIL — `Cannot find module './TranscriptRow'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { ClarificationCard } from "./ClarificationCard"
import { ErrorState } from "./ErrorState"
import { ProposalCard } from "./ProposalCard"

import { useAgentPost } from "@/hooks/useAgentPost"
import type { ThreadRow } from "@/lib/agent/convertMessage"
import { isProposal } from "@/lib/agent/proposalToParts"
import { stripProposalTags } from "@/lib/agent/stripProposalTags"

export function Prose({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function ErrorRowWrapper({
  entity_ref,
  error,
}: {
  entity_ref: string
  error: { message: string; details?: unknown }
}) {
  const { send } = useAgentPost(entity_ref)
  return <ErrorState entity_ref={entity_ref} error={error} onRetry={() => { void send("") }} />
}

export function TranscriptRow({ entity_ref, row }: { entity_ref: string; row: ThreadRow }) {
  if (row.kind === "user_message") {
    return (
      <div className="ml-auto max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-sm">
        {row.body_markdown}
      </div>
    )
  }

  if (row.kind === "assistant_message") {
    return (
      <div className="text-sm">
        <Prose text={stripProposalTags(row.body_markdown ?? "")} />
      </div>
    )
  }

  if (row.kind === "proposal" && isProposal(row.proposal_json)) {
    if (row.proposal_json.kind === "clarification") {
      return <ClarificationCard entity_ref={entity_ref} proposal={row.proposal_json} />
    }
    return (
      <ProposalCard
        entity_ref={entity_ref}
        proposal={row.proposal_json}
        checkpoint_id={row.checkpoint_id ?? null}
      />
    )
  }

  if (row.kind === "execution_result") {
    return (
      <div className="text-sm rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
        <div className="flex gap-2">
          <span className="text-emerald-600">✓</span>
          <Prose text={stripProposalTags(row.body_markdown ?? "")} />
        </div>
      </div>
    )
  }

  if (row.kind === "error") {
    const errObj = (row.error_json ?? { message: "Unknown error" }) as {
      message: string
      details?: unknown
    }
    return <ErrorRowWrapper entity_ref={entity_ref} error={errObj} />
  }

  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test app/src/components/agent/TranscriptRow.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
command git add app/src/components/agent/TranscriptRow.tsx app/src/components/agent/TranscriptRow.test.tsx
command git commit -m "feat(agent): TranscriptRow — route clarifications, render receipts as markdown"
```

---

## Task 3: Wire AgentTranscript to TranscriptRow

**Files:**
- Modify: `app/src/components/agent/AgentTranscript.tsx`
- Modify: `app/src/components/agent/index.ts`

- [ ] **Step 1: Replace the row-rendering body of `AgentTranscript.tsx`**

Replace the entire file with:

```tsx
import { AssistantRuntimeProvider, ThreadPrimitive } from "@assistant-ui/react"

import { TranscriptRow } from "./TranscriptRow"
import { WorkLogGroup } from "./WorkLogGroup"

import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { groupWorkLog } from "@/lib/agent/workLogGrouping"

export function AgentTranscript({ entity_ref }: { entity_ref: string }) {
  const { runtime, rows, isLoading } = useAgentRuntime(entity_ref)
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  const grouped = groupWorkLog(rows ?? [])
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex flex-col gap-3">
        <ThreadPrimitive.Viewport>
          <div className="flex flex-col gap-3">
            {grouped.map((item) => {
              if (item.type === "group") {
                return (
                  <WorkLogGroup
                    key={`g-${item.firstSequence}`}
                    items={item.items}
                    firstSequence={item.firstSequence}
                    lastSequence={item.lastSequence}
                    run_id={item.run_id}
                  />
                )
              }
              return (
                <TranscriptRow key={item.row._id} entity_ref={entity_ref} row={item.row} />
              )
            })}
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}
```

- [ ] **Step 2: Add barrel exports in `index.ts`**

Add these two lines to `app/src/components/agent/index.ts`:

```ts
export { ClarificationCard } from "./ClarificationCard"
export { TranscriptRow } from "./TranscriptRow"
```

- [ ] **Step 3: Typecheck + full app test run**

Run: `bun run typecheck:app && bun run test`
Expected: typecheck clean for touched files; vitest shows only the pre-existing baseline failures (convex auth + SignInScreen), no new failures. ClarificationCard (4) + TranscriptRow (3) pass.

- [ ] **Step 4: Commit**

```bash
command git add app/src/components/agent/AgentTranscript.tsx app/src/components/agent/index.ts
command git commit -m "refactor(agent): delegate transcript rows to TranscriptRow"
```

---

## Task 4: Engine — tighten DEFAULT_SYSTEM (Ask-X → clarification)

**Files:**
- Modify: `engine/src/runner/claudeSdkRunner.ts` (the `DEFAULT_SYSTEM` template literal, after the "Kind semantics" list ending with the `blocked` line)

- [ ] **Step 1: Insert the Ask-X rule + examples**

Find this passage (end of the Kind semantics list):

```
- "blocked": you cannot proceed (missing skill, ambiguous entity, etc.); summary explains why.
```

Immediately after it (before the `DO NOT invent new kind values` paragraph), insert:

```
**Asking the user vs. proposing an action.** If you need information that only the user (the person operating this drawer) can give you — who a person is, which of two ambiguous referents they meant, a missing preference — you MUST emit kind="clarification" with a populated "question", free_text_allowed=true, and "options" as *candidate answers*. Do NOT emit a kind="proposal" whose option is labeled "Ask Milad" / "Ask: who is X" / "Confirm X with the user" when X is the user themselves. That is the user asking the user — a bug.

  BAD (mis-kinded — the user is being asked to ask themselves):
    { "kind": "proposal", "options": [ { "id": "ask", "label": "Ask: who is Watty?", ... } ] }

  GOOD (clarification — the question is surfaced, answers are suggestions):
    { "kind": "clarification",
      "question": "Who is Watty — which person/entity does this refer to?",
      "free_text_allowed": true,
      "options": [
        { "id": "investor", "label": "A potential investor", "description": "Route under AUF > Funding.", "confidence": 0.5, "reversibility": "trivial" },
        { "id": "artist", "label": "An artist I'm booking", "description": "Route under AUF > Bookings.", "confidence": 0.5, "reversibility": "trivial" }
      ] }

  EXCEPTION — asking a *third party* is a real action, keep it as kind="proposal": "Ask Jacob via Slack", "Email Sarah to clarify her preference". Those perform an external send via a tool. The test: asking the drawer's user = clarification; asking someone else via a tool = proposal action.
```

- [ ] **Step 2: Typecheck the engine**

Run: `bun run typecheck:engine`
Expected: clean (string-only change).

- [ ] **Step 3: Commit**

```bash
command git add engine/src/runner/claudeSdkRunner.ts
command git commit -m "feat(engine): force clarification kind for user-context gaps, not Ask-X proposals"
```

---

## Task 5: Full validation + behavioral verification

- [ ] **Step 1: Full gate**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: no NEW errors in touched files; vitest baseline unchanged except the 7 new passing tests. (Pre-existing convex-auth + SignInScreen failures remain — not in scope.)

- [ ] **Step 2: Reload the engine on the Mac mini**

Run: `launchctl kickstart -k gui/$(id -u)/com.milad.agentic-engine`
Expected: no error; engine restarts with the new prompt.

- [ ] **Step 3: Browser check (app already on http://localhost:3000)**

  - Open an existing clarification thread (e.g. `todoist:task:6g7p2g4VJ9MRmhVv`) via its agent badge → question is prominent, "Common answers" chips render, composer focused; clicking a chip sends the label as a reply.
  - Open an executed thread → green receipt renders markdown (backticked text becomes inline code).

- [ ] **Step 4: Engine behavior check**

  - Re-trigger discovery on an "Ask X" entity (watty investor / alex's mailbox).
  - Run: `bunx convex run 'agentic/queries/_adminDigest:default'`
  - Expected: new conversations on context-gap entities show `kind:"clarification"` with a `question`, not an "Ask: who is X?" proposal option.

---

## Self-Review

- **Spec coverage:** (1) engine prompt → Task 4. (2a) clarification routing → Task 2 + 3. (2b) ClarificationCard UX (question/chips/free-text/focus, no Execute) → Task 1. (3) execution_result markdown → Task 2. All covered.
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `ClarificationCard` props `{ entity_ref, proposal }` match Task 2's call site; `TranscriptRow` props `{ entity_ref, row }` match Task 3's call site; `Prose` defined in `TranscriptRow.tsx`; `ThreadRow` fields used (`kind`, `body_markdown`, `proposal_json`, `checkpoint_id`, `error_json`, `_id`) match `convertMessage.ts`. `send(option.label)` matches `useAgentPost.send` signature.
- **Out of scope (unchanged):** `user_message` stays raw; runner event normalization unchanged (clarification still emitted as a `proposal` event; frontend discriminates).
