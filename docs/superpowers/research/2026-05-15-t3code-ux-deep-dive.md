# t3code UX deep-dive — patterns for the agentic engine client

**Date:** 2026-05-15
**Repo studied:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (Theo's "minimal web GUI for coding agents" — Codex, Claude, OpenCode). `pingdotgg/t3-chat` does not exist; t3code is the one.
**Frontend stack:** `apps/web` is **Vite + React 19** (matches `master-db/app`). Tanstack Router for filesystem routes, Zustand for store, Tailwind v4, Base UI primitives, Lucide icons, `react-markdown` + `remark-gfm`, `@legendapp/list` for virtualized scroll, `@formkit/auto-animate`, `@dnd-kit`, `xterm` for embedded terminals, `@tanstack/react-query`, MSW for tests, Vitest browser mode via Playwright. See [`apps/web/package.json`](https://github.com/pingdotgg/t3code/blob/main/apps/web/package.json).
**Routing shape:** flat Tanstack file routes — [`apps/web/src/routes/`](https://github.com/pingdotgg/t3code/tree/main/apps/web/src/routes). Key files: `_chat.tsx` (chat shell), `_chat.$environmentId.$threadId.tsx` (single thread), `_chat.draft.$draftId.tsx` (unsubmitted drafts as first-class), `_chat.index.tsx` (onboarding/empty), plus seven `settings.*.tsx` routes.

## 1. Thread / conversation view — `MessagesTimeline`

Source: [`apps/web/src/components/chat/MessagesTimeline.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/MessagesTimeline.tsx) + `.logic.ts`.

Raw events are normalized into a small union of **row kinds** before render:

```ts
type MessagesTimelineRow =
  | { kind: "message" }       // user or assistant
  | { kind: "work" }          // consecutive tool calls grouped
  | { kind: "proposed-plan" } // structured plan artifact
  | { kind: "working" }       // synthetic "in progress" row
```

The component switches on `row.kind` and dispatches to `UserTimelineRow`, `AssistantTimelineRow`, `WorkGroupSection`, `ProposedPlanTimelineRow`, `WorkingTimelineRow`. Two design moves worth stealing:

- **Tool calls are coalesced into a "Work log" group**, not interleaved between assistant text. A consecutive run of `work` events collapses into one section with `MAX_VISIBLE_WORK_LOG_ENTRIES` shown by default and an Expand button for the rest. This keeps the conversation readable when the agent does 20+ tool calls per turn.
- **`working` is a synthetic row**, not a backend event — derived client-side when a turn is open. Means the spinner is part of the timeline geometry (scroll anchors stay correct) rather than a floating overlay.

Density: user messages right-aligned bubbles capped at `max-w-[80%]`, assistant messages full-width prose, work entries compact `py-1.5 px-2`. Virtualized list via `<LegendList maintainScrollAtEnd />` — auto-pins to bottom during streaming, releases when user scrolls up.

## 2. Proposed plan UI — read-only artifact, not a multiple-choice picker

Source: [`apps/web/src/components/chat/ProposedPlanCard.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ProposedPlanCard.tsx).

**Important calibration for Milad:** t3code's "proposed plan" is *not* the "agent yields N options and asks the user to pick one" pattern. It's a single markdown artifact (a `/plan` output) rendered as a card with:

- Badge `"Plan"` + title, ellipsis menu for actions.
- Collapsible body: shows 10 lines with a fade-to-black gradient overlay until expanded; thresholds are >900 chars or >20 lines.
- Three actions on the menu: **Copy to clipboard**, **Download as markdown**, **Save to workspace** (opens a save-path dialog).
- No Accept/Reject/Choose buttons. The plan is informational; what to do with it is a separate composer follow-up ("ComposerPlanFollowUpBanner").

The actual binary-choice UI for the agentic engine's decision-yield (recommend/A/B/C) is **not present in t3code**, because Codex/Claude Code don't structurally yield decision proposals — they yield tool-use approvals (see §3 below). For master-db/app this means: t3code shows you how to render a single-option plan well, but the multi-option recommended-vs-alternative card needs to be designed fresh.

## 3. Approval / decision UI — the closest analog to "yield"

Source: [`ComposerPendingApprovalPanel.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx) (the banner) + [`ComposerPendingApprovalActions.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ComposerPendingApprovalActions.tsx) (the buttons).

This is the tool-use approval flow — the agent wants to run a command, read a file, or change a file, and pauses for human approval. Layout: a banner above the composer with an uppercase `"PENDING APPROVAL"` label, a typed summary (`"Command approval requested"` / `"File-read approval requested"` / `"File-change approval requested"`), and a `1/N` counter when multiple approvals are queued.

The action row has four buttons with **clear escalation gradient**:

```tsx
<Button variant="ghost"               onClick={() => onRespond("cancel")}>          Cancel turn
<Button variant="destructive-outline" onClick={() => onRespond("decline")}>         Decline
<Button variant="outline"             onClick={() => onRespond("acceptForSession")}>Always allow this session
<Button variant="default"             onClick={() => onRespond("accept")}>          Approve once
```

Worth stealing verbatim:

- **Four options, not two.** Cancel-the-whole-turn is separated from Decline-this-specific-action. Session-scoped "always allow" is separated from one-shot approve. This maps cleanly to the agentic engine's decision shape where you might want "reject and stop" vs "reject this option, propose another."
- **Approval as a banner stacked above the composer**, not a modal — the user can still see the conversation, the tool args, and type a clarifying message while deciding.
- **All buttons disable when `isResponding` is true** — single boolean prevents double-submission.

## 4. Tool call cards (work log entries)

t3code renders tool calls compactly inside the grouped Work log. `SimpleWorkEntryRow` is the per-entry component; the group itself handles collapse/expand. There is no per-tool-call streaming spinner — instead, the *whole turn* has a `WorkingTimelineRow` showing it's still in flight. Output formatting goes through `ChatMarkdown.tsx` which is `react-markdown` + `remark-gfm`. Files changed by tools surface in a separate `<ChangedFilesTree>` panel (right side), not inline in the timeline — chat stays narrative, diffs live in a dedicated pane.

## 5. Streaming / "live thinking"

Source: `WorkingTimelineRow` in `MessagesTimeline.tsx`. Three pulsing dots with staggered 200ms delays:

```tsx
<span className="inline-flex items-center gap-[3px]">
  <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
  <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
  <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
</span>
```

Plus a **self-ticking elapsed timer** — `setInterval(updateText, 1000)` mutates `textRef.current.textContent` directly rather than re-rendering, so a 5-minute working turn doesn't trigger 300 React renders. Worth copying for the engine's long-running threads.

Auto-scroll uses `listRef.current?.scrollToEnd({ animated: false })` via LegendList's `maintainScrollAtEnd`. No fade-in/typewriter animations on assistant text — content appears as the stream chunks arrive, which is honest about latency.

## 6. Queue / multi-thread view — `Sidebar`

Source: [`apps/web/src/components/Sidebar.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/Sidebar.tsx).

Threads are listed under projects (the "entity" analog). Three grouping modes via `PROJECT_GROUPING_MODE_LABELS`: by repository, by repository path, or kept separate. Each `SidebarThreadRow` shows:

- Title + last-user-message preview.
- **Stacked status pills** with semantic colors:
  - Thread status — `working` / `idle` / `awaiting` via `<ThreadStatusLabel>` ([`ThreadStatusIndicators.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/ThreadStatusIndicators.tsx)).
  - PR status — emerald (open), zinc (closed), violet (merged).
  - Terminal status — teal with `animate-pulse` when a terminal is mid-execution.
- Relative timestamp.
- Cloud icon when the thread runs in a non-primary environment.
- Inline keyboard-jump label.
- Two-step archive confirmation (no accidental destructive clicks).

Translation to master-db/app: this is the model for the per-entity thread list. The "status pill stack" pattern — agent state + downstream artifact state (PR / terminal) on the same row — is the right density for a burndown view.

## 7. Interrupt / multitask — `ComposerPrimaryActions`

Source: [`ComposerPrimaryActions.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ComposerPrimaryActions.tsx). The submit affordance **swaps identity** based on `isRunning`:

- **Idle:** circular send button, primary fill, up-arrow icon (or spinner if `isConnecting || isSendBusy`).
- **Running:** circular stop button, `bg-rose-500/90`, square stop icon, `aria-label="Stop generation"`.

No confirmation modal — single click interrupts. The state change is the confirmation: the button color and icon flip, the working row disappears from the timeline.

## 8. Resume / fork from checkpoint

**Not exposed in the UI.** No "fork from this message" or "try a different option" affordance. The closest thing is `onPreviousPendingQuestion` — stepping backward through a multi-question approval queue. The fact that even Theo's app skips this despite the protocol supporting it is a useful signal: it's complex to do well and may not be worth shipping in v1.

## 9. Keyboard / power-user nav

Source: [`keybindings.ts`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/keybindings.ts) — actual key strings come from `@t3tools/contracts` so they're user-configurable. Surface area:

- New chat / new local chat
- Jump to specific thread (numbered)
- Jump to model picker
- Toggle / split / create / close terminal
- Toggle diff panel
- Open in favorite editor
- Terminal-local: clear (Ctrl+L / Cmd+K on Mac), word/line navigation, deletion modifiers.

Settings has a dedicated [`settings.keybindings.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/routes/settings.keybindings.tsx) route — keybindings are a first-class settings page, not buried.

The Command Palette ([`CommandPalette.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/CommandPalette.tsx)) is the other power-user surface: project add/clone, thread switch, new thread, settings jumps. Query starting with `>` switches to **actions-only mode** (hides project/thread results). Won't activate when the terminal has focus — context-aware.

## 10. App shell & layout

`_chat.tsx` provides the shell: `SidebarInset` left, main pane center with `ChatHeader` + `MessagesTimeline` + `ChatComposer` vertically stacked, `PersistentThreadTerminalDrawer` collapsible at the bottom, right-side sheets for `DiffPanel` and `PullRequestThreadDialog`. The header ([`ChatHeader.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ChatHeader.tsx)) carries thread title, project badge, git status badge, project scripts dropdown, "Open in editor" picker, terminal toggle, diff panel toggle. The composer stack from top to bottom: `ComposerBannerStack` (provider status, errors), `ComposerPendingApprovalPanel` (when applicable), `ComposerPendingUserInputPanel`, `ComposerPlanFollowUpBanner`, then the `ComposerPromptEditor` + `ComposerPrimaryActions` row, with `ContextWindowMeter` and `CompactComposerControlsMenu` underneath.

## 11. Visual language

- **Tailwind v4** with semantic CSS variables (`text-muted-foreground`, `bg-primary`, `bg-card`). Light/dark variants throughout.
- **Status color palette:** emerald (success/open), rose (stop/destructive), violet (merged), teal (terminal active), zinc (neutral/closed) — narrow, semantic, consistent.
- **Pills, not badges.** Small dot + label, optional pulse animation for live state.
- **`@formkit/auto-animate`** for list reorder/insert animations (much cheaper than Framer Motion for this use case).
- **`class-variance-authority`** for button variants (`ghost` / `outline` / `destructive-outline` / `default`).
- Border radius hierarchy: `rounded-full` for action buttons, `rounded-3xl` for empty-state cards, default rounding for chat bubbles.

## What translates well to `master-db/app`

1. **Row-kind union driving the timeline.** Decouple raw event stream from render — derive `{kind: "message" | "work" | "decision" | "working"}` rows client-side. Stack matches: Vite + React 19 + Tanstack Router + Zustand.
2. **Work-log grouping.** Coalesce consecutive tool calls; show last-N with expand. Critical for the engine's per-thread queues that can do many small actions.
3. **Approval banner with four-button gradient** (Cancel turn / Decline / Always allow / Approve once). Maps directly to the engine's decision-yield: Cancel = abort thread, Decline = reject this option, Always allow = save preference, Approve = take recommended.
4. **Status-pill stack in the entity/thread list** — agent state + downstream artifact state on the same row, with semantic colors and pulse-on-live.
5. **Send/Stop button identity-swap** with no confirmation modal.
6. **Self-ticking elapsed timer via direct DOM mutation** for long-running turns.
7. **Settings as a routed sub-tree** (`settings.*.tsx` flat files) with keybindings as a first-class page.

## What NOT to copy

1. **Read-only ProposedPlanCard is not the decision-yield UI you actually need.** The engine's value prop is structured options with a recommendation and reversibility/confidence metadata — design that fresh. t3code's plan card is just markdown-in-a-fade-to-black box.
2. **No fork-from-message.** Even Theo skipped it. Don't ship it in v1.
3. **Terminal-coupled UI** (xterm drawer, project scripts dropdown, "Open in editor"). Entirely coding-agent specific; master-db/app's entities are tasks/threads/burndowns, not repos.
4. **Onboarding is "Connect an environment to get started"** — single button, no list of recent threads. For a per-entity engine where every entity already has threads, default to a queue/burndown view, not an empty onboarding card.
5. **Project grouping modes (`by-repo` / `by-repo-path` / `separate`).** Three settings for one decision is a UX smell; pick one grouping for the engine and commit.
6. **No reasoning blocks.** t3code doesn't render `<thinking>` content at all. If the engine surfaces reasoning, that's a deliberate divergence — borrow nothing from t3code here.
