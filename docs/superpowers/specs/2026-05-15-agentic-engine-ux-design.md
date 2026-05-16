# Agentic Engine — UX Design (Phase 1: per-entity drawer)

**Date:** 2026-05-15
**Status:** Draft, ready for implementation planning
**Scope:** The client UX for the agentic engine, Phase 1 only — a per-entity Agent drawer inside the existing `app/` Vite + React Todoist UI. Phases 2–4 (burndown queue route, notifications, auto-execute rules) are sketched at the bottom; they get their own specs when their time comes.

**Companion docs:**
- Server spec: [`docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md`](2026-05-15-agentic-engine-web-server-design.md)
- Server plan: [`docs/superpowers/plans/2026-05-15-agentic-engine-web-server-implementation.md`](../plans/2026-05-15-agentic-engine-web-server-implementation.md)
- t3code UX deep-dive: [`docs/superpowers/research/2026-05-15-t3code-ux-deep-dive.md`](../research/2026-05-15-t3code-ux-deep-dive.md)
- Chat-UX library survey: [`docs/superpowers/research/2026-05-15-chat-ux-library-survey.md`](../research/2026-05-15-chat-ux-library-survey.md)

---

## Purpose

When a user opens a Todoist task in `app/`, an Agent drawer slides in from the right showing the per-entity agent thread for that task: prose transcript interleaved with collapsible tool-call / reasoning groups, the latest structured `Proposal` rendered as per-option cards with decision buttons, and an always-visible composer for free-text follow-ups. Auto-triggers a discovery run on open. Renders entirely from Convex reactive queries; the engine server is talked to only for writes (`POST /run` and `/run/:ref/interrupt`).

This is the workhorse surface. Get it right and Phases 2–4 are reskins of the same components.

## Non-goals (Phase 1)

- The burndown queue route across entities.
- Beeper / Slack / push notifications on state transitions.
- The auto-execute rules editor.
- Per-tool specialized cards (search_obsidian → link list, read_calendar → event card, etc.). We ship one generic `ToolCallCard`; specializations are a reserved seam.
- Wiring the "fork from checkpoint" affordance. UI is reserved; the server doesn't expose `from_checkpoint` in v1.
- Cost / token-usage display. Reserved seam.
- Mobile-specific layout work beyond verifying the shadcn Sheet primitive's built-in responsive behavior.

## Architecture

```
TaskListView item → "Open Agent" button or kbd `g a`
                              ↓
        AgentDrawerContext.open({ entity_ref })
        Wouter URL param ?agent=todoist:task:1234 added
                              ↓
   <AgentDrawer entity_ref="todoist:task:1234"> mounts via DialogManager
                              ↓
   useAgentRuntime()
    ├── useQuery(api.agentic.queries.getThread, { entity_ref })
    ├── useQuery(api.agentic.queries.getRun,    { entity_ref })
    └── useExternalStoreRuntime({
          messages:   convertedFromConvex,
          isRunning:  status ∈ { discovering, executing },
          onNew:      postRun(...),
          onCancel:   postInterrupt(...),
        })
                              ↓
   assistant-ui <Thread> renders, slotted renderers for:
    • data-proposal      → <ProposalCard>
    • tool-call activity → <ToolCallCard>
    • reasoning kind     → coalesced into <WorkLogGroup>
```

Convex is the single source of truth on the read path. We never read from the engine. Every render reflects whatever Convex has pushed. Writes are fire-and-forget HTTP `POST` to the engine; the *result* arrives 30–90s later as a Convex push and we just rerender.

### Library choice

**`@assistant-ui/react` with `ExternalStoreRuntime`** — selected per the chat-UX library survey. Picked for three reasons specific to us:

1. `ExternalStoreRuntime` is purpose-designed for "messages live in your store, library renders" — adapter takes `{ messages, isRunning, onNew, onCancel, convertMessage }` and the runtime stays state-agnostic. Convex slots in identically to the documented Redux/Zustand/TanStack patterns.
2. Custom message kinds via `data-*` parts (`{ type: "data-proposal", data: {...} }`) render natively alongside text bubbles. Every other serious candidate hardcodes `user | assistant | tool` and treats our multi-option proposal as a second-class citizen.
3. `makeAssistantToolUI({ toolName, render })` with a `ToolFallback` for unknowns maps directly to `agenticThreadActivities` rows.

**Risk to verify in a 1-day spike before the full build:** assistant-ui's runtime models a single "running" agent per thread. Our per-entity async-proposal model maps to `isRunning = (status === "discovering" || status === "executing")`. Spike commits to this mapping with one seeded thread; if it survives, build out. If it fights us, fall back to Vercel AI Elements (survey runner-up).

## File layout

All new files under `app/src/`:

```
components/agent/
  AgentDrawer.tsx              Sheet wrapper; mounts runtime; orchestrates
  AgentTranscript.tsx          Thread.Root + slotted renderers
  WorkLogGroup.tsx             coalesced reasoning + tool-call group
  ToolCallCard.tsx             generic collapsible; per-tool variants later
  ProposalCard.tsx             per-option cards (Layout A)
  ProposalOptionRow.tsx        one option card
  AgentComposer.tsx            Composer.Root with Send/Stop swap
  ThinkingIndicator.tsx        3-dot pulse + self-ticking timer (t3code port)
  StatusPill.tsx               run status → colored badge
  ErrorState.tsx               kind=error rendering, retry
  RewindButton.tsx             reserved seam: fork-from-checkpoint, v1 toast stub
  index.ts
hooks/
  useAgentRuntime.ts           wraps useExternalStoreRuntime + Convex queries
  useAgentPost.ts              postRun helper with idempotency
  useAgentKeybindings.ts       g-a opener, j/k/1-N/m/esc inside drawer
lib/
  agent/
    convertMessage.ts          Convex row → assistant-ui ThreadMessage
    proposalToParts.ts         Proposal payload → data-proposal part
    workLogGrouping.ts         t3code-ported algorithm (MIT attributed)
    engineClient.ts            fetch wrapper: POST /run, /interrupt
    tool-registry.ts           name → custom renderer; empty in v1
contexts/
  AgentDrawerContext.tsx       open/close + active entity_ref
spike/                         deleted after Step A
  AgentSpike.tsx               1-day proof of runtime mapping
```

No changes to `engine/`, `convex/agentic/`, or `convex/schema/agentic/`. We only consume what the server agent ships.

## Visible UX surfaces

### Trigger

Two entry points:

1. **"🤖 Agent" button** on the task detail header, beside existing complete/edit/dropdown actions.
2. **Keyboard shortcut `g a`** (vim-style two-stroke). "Active task" = whichever task is focused in `TaskListView` *or* open in detail view. Resolution is single-source via `useTaskSelection` (existing). Falls through silently if no task is active.

Both call `openAgentDrawer({ entity_ref })` from `AgentDrawerContext`, which routes through the existing `DialogManager` / `DialogProvider` contract. A Wouter URL param `?agent=<entity_ref>` is set so the drawer state is linkable and survives reloads. The drawer subscribes to URL changes too: navigating browser-back while the drawer is open closes it (URL is authoritative).

### Drawer shell (`AgentDrawer.tsx`)

shadcn `<Sheet side="right">`, ~640px desktop, full-width on mobile (the Sheet primitive already handles the responsive bottom-sheet behavior; we verify, we don't build it).

- **Header row:** task title (links back to task detail) · `<StatusPill>` · `(⌘E to focus composer)` kbd hint · close button.
- **Body:** scrollable `<Thread.Viewport>` (transcript).
- **Footer (sticky):** `<AgentComposer>`.
- **Escape:** if a run is in flight, first press focuses the Stop button (friction layer to prevent accidental dismissal of an in-flight thought); second press closes the drawer. If idle, single press closes.

### Auto-trigger on open

When the drawer mounts, we read `getRun` and fire one `postRun({ entity_ref, message: null, multitask_strategy: "enqueue" })` if the run doesn't already exist or hasn't been triggered this mount. The call carries `Idempotency-Key = "${entity_ref}:open:${mountId}"`, where `mountId` is `useRef(ulid())` evaluated once on mount — stable across renders, distinct per drawer-open. Re-renders no-op locally; if the user closes and reopens the drawer, a new `mountId` is generated and the call hits the server again (which then no-ops via the server's own idempotency cache + null-message-with-existing-run rule).

### Transcript (`AgentTranscript.tsx`)

Driven by assistant-ui's `<Thread.Messages>` over `useExternalStoreRuntime`. Renderers per Convex row:

| Convex row | Renders as |
|---|---|
| `kind: "user_message"` | Right-aligned bubble, `max-w-[80%]` |
| `kind: "assistant_message"` | Full-width prose via `react-markdown` + `remark-gfm` |
| `kind: "reasoning"` | Coalesces into `<WorkLogGroup>`; never its own bubble |
| `kind: "proposal"` | `<ProposalCard>` rendered via `data-proposal` part |
| `kind: "execution_result"` | Compact green-tinted card: "✓ Executed: <option label>" |
| `kind: "error"` | `<ErrorState>` with retry button |
| activity `kind: "tool_call"` | Coalesces into `<WorkLogGroup>` |
| activity `kind: "approval_request"` / `"approval_response"` | (Reserved; not in Phase 1) |

Scroll: auto-pin to bottom while streaming, release on user scroll-up. assistant-ui's `Thread.Viewport` handles this.

### Work-log grouping (`WorkLogGroup.tsx`)

Algorithm ported from t3code `MessagesTimeline.logic.ts` (MIT attribution). Walks the interleaved Convex rows; coalesces *consecutive* `reasoning` + `tool_call` rows into one group. Group header: `"Work log · 12 items · 47s"` with elapsed = `last.ts − first.ts`. Last 3 items visible by default, rest behind `"Show all 12 ↓"`. The group ends when:

- A non-process kind appears (`assistant_message` / `proposal` / `execution_result` / `error`), or
- `run_id` changes (turn boundary).

### Proposal card (`ProposalCard.tsx`, `ProposalOptionRow.tsx`)

Per-option stacked cards (Layout A). Above the cards: the proposal's `summary` (markdown) and `findings` (tight bullet list under a muted "Receipts" header).

Each option card:

- **Header row:** option label (bold) · `"★ Recommended"` badge right-aligned when `id === recommended_option_id`.
- **Description:** the option's `description` string.
- **Rationale:** if present, smaller muted text below description.
- **Metadata pills:** `confidence` ("85%") · `reversibility` (color-coded: trivial=emerald, moderate=amber, destructive=rose) · each `side_effect` as a neutral chip.
- **Action row:** `Execute` button (primary on recommended, secondary on others) · `Modify…` ghost button.
- **Footer:** `↪︎ Rewind here` ghost button (reserved seam; v1 fires a sonner toast "Rewind not yet available — coming in Phase 2"). The `checkpoint_id` is read off the row but unused in v1.

Decision wiring:
- `Execute` on option X → `postRun({ entity_ref, message: "EXECUTE: X", multitask_strategy: "interrupt" })`. The `interrupt` strategy handles the rare case of clicking Execute while another decision is mid-flight.
- `Modify…` on option X → focuses the composer and pre-fills it with `Modify option X: `. On send, we wrap to `MODIFY: X: <text>` on the wire. The pre-fill is editable plain text; deleting it sends plain free text.

### Composer (`AgentComposer.tsx`)

assistant-ui's `<Composer.Root>` + `<Composer.Input>` (textarea) + Send/Stop identity-swap via `<Composer.Send>` and `<Composer.Cancel>` gated by `isRunning`.

- **Idle:** primary circle, up-arrow icon. ⌘+Enter sends.
- **Running:** rose circle, square stop icon. Click → `POST /run/:entity_ref/interrupt`. No confirmation modal — the color/icon swap *is* the confirmation.
- Empty input + Enter is a no-op.
- Always visible. If a future `Proposal` arrives with `free_text_allowed: false`, the composer renders disabled with a tooltip explaining why; the input remains visible for transparency.

### Live thinking indicator (`ThinkingIndicator.tsx`)

t3code `WorkingTimelineRow` port (MIT attribution). Renders as the last item in the transcript whenever `agenticRuns.status` is `discovering` or `executing` — inside the timeline, not a floating overlay, so scroll geometry stays consistent.

Visual: three 4px dots with `animate-pulse` and staggered 200ms delays + inline elapsed timer. The timer **self-mutates `textRef.current.textContent` inside a `setInterval`** instead of going through React state. A 5-minute thinking turn doesn't cost ~300 React renders. Disappears the instant a terminal row lands in Convex.

### Status pill (`StatusPill.tsx`)

In the drawer header. Maps `agenticRuns.status`:

| Status | Color | Text | Behavior |
|---|---|---|---|
| `idle` | neutral | "Idle" | brief; auto-trigger usually flips it within ms |
| `discovering` | blue | "Thinking" | `animate-pulse` |
| `awaiting_decision` | amber | "Awaiting you" | static |
| `executing` | blue | "Executing" | `animate-pulse` |
| `error` | rose | "Error" | static; clickable, scrolls to the error row |

Also the keyboard target for the "first Escape" Stop-focus behavior.

### Error state (`ErrorState.tsx`)

For rows with `kind: "error"`: rose left-border card with single-line error summary, collapsible JSON details (copy-to-clipboard inside a `<pre>`), and two buttons:

- **Retry:** re-fires `postRun` with the prior turn's message and a fresh `Idempotency-Key`.
- **Ask the agent:** focuses the composer with no pre-fill.

If `agenticRuns.status === "error"` *but no row in the current run has `kind: "error"`* (e.g., the server died mid-turn before writing one), the drawer body shows a single full-width error card sourced from `agenticRuns.last_error`. **This field does not exist yet in the server schema** — flagged in Open Questions; needs a server-side add before this branch can render.

## Reserved seams (Phase 1 builds the affordance, defers the wiring)

1. **Fork from checkpoint.** `RewindButton` is rendered on every proposal card. Click → toast stub. Once the server adds `from_checkpoint` to `POST /run`, only the toast handler changes.
2. **Per-tool card variants.** `ToolCallCard` consults `lib/agent/tool-registry.ts` for a `name → renderer` override; the registry is empty in v1. Specializations drop in without touching the transcript.
3. **Keyboard model.** `useAgentKeybindings` binds at drawer root only when focused: `j`/`k` (next/prev row), `1`/`2`/`3`/`4` (pick option N's Execute), `m` (focus composer in modify mode for the highlighted option), `esc` (close / stop), `⌘+Enter` (send). Phase 2's queue reuses the same handler.
4. **Mobile / PWA.** No special code path; verify that the Sheet primitive's built-in `<sm:` breakpoint behavior gives us a full-screen bottom sheet.
5. **Auto-execute rules.** Composer's send-handler routes through `shouldAutoExecute(proposal)` — always returns `false` in v1. Phase 4 swaps in a real predicate evaluator without touching this file.
6. **Convex-action-driven discovery.** When a Convex action triggers discovery in the background (so drawer-open finds a ready proposal), no UI change is needed — the same Convex query reactively rerenders.
7. **Cost meter.** `token_usage` is read off rows but not displayed. The drawer header reserves a small footer slot for the eventual cost readout.

## Data flow & idempotency

| Action | Wire call | `Idempotency-Key` |
|---|---|---|
| Drawer mounts | `POST /run` with `message: null` | `"${entity_ref}:open:${session-mount-id}"` |
| User clicks `Execute` on option X | `POST /run` with `"EXECUTE: X"`, `multitask_strategy: "interrupt"` | fresh `ulid()` per click |
| User clicks `Modify…` and sends | `POST /run` with `"MODIFY: X: <text>"` | fresh `ulid()` per send |
| User sends free text | `POST /run` with text, `multitask_strategy: "enqueue"` | fresh `ulid()` per send |
| User clicks Stop | `POST /run/:entity_ref/interrupt` | not idempotent — server-side cancel is naturally idempotent |
| User clicks Retry on an error row | `POST /run` with prior turn's message | fresh `ulid()` |

`engineClient.ts` is the single wrapper. Bearer token loaded from `import.meta.env.VITE_AGENTIC_ENGINE_TOKEN` for dev; production deploy reads it from the server-side at proxy. `engineClient` returns the immediate `{run_id, status, accepted}` response but the UI does *not* depend on it for rendering — it only logs to console and surfaces a sonner toast if `accepted: false`.

## Tech stack additions

| Package | Purpose |
|---|---|
| `@assistant-ui/react` | Thread/Composer/Message primitives + ExternalStoreRuntime |
| `react-markdown` | Render `body_markdown` and proposal `summary` |
| `remark-gfm` | GitHub-flavored markdown |
| `tw-animate-css` | Tailwind v4 replacement for the `tailwindcss-animate` plugin (added as part of PR 2, the v4 migration) |
| `@testing-library/react` (devDep) | Component interaction tests |

Lifted t3code patterns (≈100 LOC total, reimplemented in our stack) get a top-of-file comment: `// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md`. A new `THIRD_PARTY_NOTICES.md` at repo root carries the attribution + commit SHA at lift time + the MIT license text.

## Prerequisite PRs (must land before feature work)

**PR 1: React 18 → 19 bump.**
- `bun add react@^19 react-dom@^19 @types/react@^19 @types/react-dom@^19`
- Fix ref-as-prop typing churn.
- Smoke test app: Convex queries, dialogs, sidebar nav, theme.
- ~1–3 hours.

**PR 2: Tailwind v3 → v4 migration.**
- `npx @tailwindcss/upgrade@latest`.
- Replace `postcss` + `tailwindcss` config with `@tailwindcss/vite` in `vite.config.ts`.
- `bun remove tailwindcss-animate && bun add tw-animate-css`; `@import "tw-animate-css";` in `index.css`.
- Move CSS variables into a `@theme` block in `index.css`.
- Verify the 8 components using animate classes (`popover`, `sheet`, `tooltip`, `dialog`, `checkbox`, `dropdown-menu`, `select`, `sidebar`) still animate.
- ~half day.

Both land green on `bun run typecheck && bun run lint && bun test` before PR 3 starts.

## Build sequence (PR 3+)

### Step A — Spike (1 day, throwaway-friendly)

Branch: `agentic-engine-ux-spike`. Goal: prove `ExternalStoreRuntime` + Convex + `data-proposal` part shape map cleanly.

- `bun add @assistant-ui/react react-markdown remark-gfm`.
- One seed thread in `convex/agentic/dev/seed.ts`: one entity_ref, 2 user messages, 1 assistant_message, 3 tool calls, 1 proposal with 3 options.
- One file: `app/src/spike/AgentSpike.tsx` mounts `useExternalStoreRuntime({ messages: useQuery(getThread, ...) })`, registers a `data-proposal` part that prints `<pre>{JSON}</pre>`, registers `makeAssistantToolUI` with `ToolFallback`.
- Temporary route `/spike` via Wouter.

Decision gate:
- ✅ Runtime renders, `isRunning` mapping holds, custom parts work → kill the spike branch, start Step B.
- ❌ Runtime fights us → abandon assistant-ui; reopen with Vercel AI Elements (survey runner-up).

### Step B — Production build (single branch, small commits)

Branch: `agentic-engine-ux`. Commits in this order, each independently reviewable:

1. **Setup.** New deps, `components/agent/index.ts` scaffolding, `THIRD_PARTY_NOTICES.md`, empty component stubs.
2. **Convertor + utilities.** `convertMessage.ts`, `proposalToParts.ts`, `workLogGrouping.ts` with co-located `*.test.ts`. Pure functions, exhaustively unit-tested without DOM.
3. **Drawer shell.** `AgentDrawerContext`, `AgentDrawer.tsx`, trigger button in task view, `g a` kbd binding. Drawer opens/closes; body is a `TODO` placeholder.
4. **Transcript.** `useAgentRuntime`, `<Thread>` rendered with text-message renderers only. Real Convex thread renders end-to-end.
5. **Work-log grouping.** `WorkLogGroup.tsx` + grouping algorithm.
6. **Tool call card.** `ToolCallCard.tsx` + empty `tool-registry.ts`.
7. **Proposal card.** `ProposalCard.tsx`, `ProposalOptionRow.tsx`. `Execute` and `Modify…` wired to `postRun`.
8. **Composer.** Send/Stop swap, ⌘+Enter, MODIFY pre-fill.
9. **Status & thinking.** `StatusPill.tsx`, `ThinkingIndicator.tsx` with self-ticking timer.
10. **Error state.** `ErrorState.tsx` + retry wiring.
11. **Reserved seams.** `RewindButton.tsx` toast stub, `shouldAutoExecute` predicate stub, mobile responsiveness verification.

Each commit ≈ one reviewable PR-worth. Land as one PR with these commit boundaries or split based on review velocity.

## Testing

- **Pure functions (high coverage).** `convertMessage.test.ts`, `proposalToParts.test.ts`, `workLogGrouping.test.ts`. No DOM. Exhaustive on turn boundaries, empty groups, error-row insertion, recommended-option treatment, `run_id` changes mid-stream.
- **Components (focused interaction tests).** `@testing-library/react`. Per component: renders on minimal Convex data, decision buttons fire correct `postRun` payload, Send/Stop swaps on `isRunning`, ⌘+Enter sends, Esc closes, expand/collapse of work-log group. **No snapshot tests** — they bit-rot in a UI still finding its shape.
- **Integration (one happy path).** `app/test/agent-drawer.integration.test.tsx` mounts the drawer against `convex-test` seeded from `convex/agentic/dev/seed.ts`: open → render transcript → click Execute → assert correct `postRun` was called → simulate Convex push of execution_result → assert UI updated. End-to-end without a real engine.
- **Test fixtures.** `convex/agentic/dev/seed.ts` carries one canonical "fully populated thread." Consumed by both the dev seed CLI (for manual UI iteration) and the integration test.
- **Not testing in Phase 1:** real engine HTTP round-trips, real Anthropic API, multi-entity concurrency, mobile layout (smoke-verify manually).

**Validation gate per commit:** `bun run typecheck && bun run lint && bun test`. All must pass.

## Future phases (informational sketch)

- **Phase 2 — Burndown queue route (`/agent/queue`).** New Wouter route. New `convex/agentic/queries/listAwaitingDecision.ts` using the existing `by_status_and_updated_at` index. New `QueueRow.tsx` (the t3code status-pill-stack pattern lifted here). Reuses Phase 1 keyboard bindings and the same `AgentDrawer` (clicking a row opens the drawer over the focused list item). New sidebar entry. ~1–2 day build.
- **Phase 3 — Notification surface.** Server-side: a Convex action on `agenticRuns.status` transitions posts to Beeper/Slack/iOS push via existing skills. UI: a single `/settings/agent-notifications` toggle page. Tiny UI; weight is in the Convex action.
- **Phase 4 — Auto-execute rules editor.** New `convex/agentic/autoExecuteRules` table + client-side evaluator. `/settings/agent-rules` predicate-builder UI (confidence ≥ X · reversibility ∈ S · side_effects ⊆ allowed). Phase 1's `shouldAutoExecute` stub becomes a real evaluator. Reads historical proposals to show a "would have auto-executed N proposals" preview before saving a rule.

## Open questions / parking lot

1. **Manual start on tasks the Convex auto-trigger ignored.** Phase 1 assumes "any task can open the drawer." If we want product-policy gating (e.g., only Inbox tasks auto-trigger), that's a separate decision; doesn't change UX shape.
2. **Multi-run history filter.** The spec allows many `run_id`s sharing one `entity_ref`. Phase 1 renders all rows in order. Phase 2+ may want a "Show only this run" filter. Reserved seam: `run_id` is on every row.
3. **`agenticRuns.last_error` field.** Required for the "server died mid-turn before writing an error row" branch of `<ErrorState>`. Needs a server-side schema add — flagged for the implementation plan's coordination with the server agent.
4. **Bearer token in the browser.** Phase 1 reads `VITE_AGENTIC_ENGINE_TOKEN` from build-time env for dev. Production deployment will need either a reverse-proxy with token injection or a thin Convex action that proxies the engine call. Out of scope for this UX spec; flagged for deployment design.
