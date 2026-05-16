# Agentic Engine UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Plan is resumable via superpowers:plan-resume — last completed task is the resume point.

**Goal:** Ship the Phase 1 per-entity Agent drawer inside `app/` — a side sheet that renders the agentic engine's per-entity thread (messages + activities) from Convex and surfaces structured Proposal cards with Execute/Modify decision buttons. Auto-triggers a discovery run on open. Built on `@assistant-ui/react` with `ExternalStoreRuntime`.

**Architecture:** Convex reactive queries are the read source of truth. `useExternalStoreRuntime` adapter feeds Convex rows into assistant-ui's `<Thread>` primitives. Custom `data-proposal` part renders multi-option decision cards. `makeAssistantToolUI` renders tool-call activities. Writes go to the engine via `POST /run` with idempotency keys. Four small visual patterns lifted from t3code (MIT, attributed).

**Tech Stack:** Bun, React 19, Vite, TypeScript strict, shadcn/ui (Radix + Tailwind v4), Wouter, Convex react client, `@assistant-ui/react`, `react-markdown` + `remark-gfm`, `tw-animate-css`, `vitest`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-05-15-agentic-engine-ux-design.md`. **Server spec:** `docs/superpowers/specs/2026-05-15-agentic-engine-web-server-design.md`. **Server plan:** `docs/superpowers/plans/2026-05-15-agentic-engine-web-server-implementation.md`. Read all three before starting Task 1.

**Validation gate per commit:** `bun run typecheck && bun run lint && bun test` — all green. No new errors in files touched.

---

## Prerequisite: server-side Convex schema must be merged

This plan consumes `convex/agentic/` (schema + mutations + queries) which is built by the server agent in a parallel worktree. Tasks 1–9 of the server plan must be complete and merged into `main` before this plan's feature work (Task 3 onward) can start. Tasks 1 and 2 of this plan (the React + Tailwind bumps) are independent and can land before the server work merges.

- [ ] **Step 0.1: Verify server-side Convex schema exists on main**

```bash
cd ~/Documents/GitHub/master-db
git fetch origin && git pull --ff-only origin main
ls convex/agentic/queries/getThread.ts convex/agentic/queries/getRun.ts \
   convex/agentic/mutations/upsertRun.ts convex/agentic/mutations/appendThreadMessage.ts \
   convex/agentic/mutations/recordActivity.ts convex/agentic/mutations.ts convex/agentic/queries.ts
```

Expected: all seven files exist.

If any are missing, STOP. The server agent's tasks 2–9 are not done yet. Either wait for them to merge or run the prerequisite bumps (Tasks 1 and 2 of THIS plan) while you wait — they don't touch `convex/agentic/`.

- [ ] **Step 0.2: Verify a clean baseline**

```bash
cd ~/Documents/GitHub/master-db
bun install
bun run typecheck && bun run lint && bun test
```

Expected: all three pass. If any fail with errors in files YOU haven't touched, note them as the pre-existing baseline; the gate for your own work is "no new errors."

---

## Task 1: PR 1 — React 18 → 19 bump

**Goal:** Bump the React major version. Standalone PR. ~1–3 hours.

**Files:**
- Modify: `app/package.json` (deps)
- Possibly modify: any file using `forwardRef` or `React.RefObject<T>` typings that ref-as-prop typing tightens — fix as the typechecker surfaces them.
- Modify: `bun.lock` (regenerated)

**Branch:** `agentic-engine-ux/react-19`

- [ ] **Step 1.1: Create branch**

```bash
cd ~/Documents/GitHub/master-db
git checkout main && git pull --ff-only
git checkout -b agentic-engine-ux/react-19
```

- [ ] **Step 1.2: Bump React + types**

```bash
cd ~/Documents/GitHub/master-db
bun add --cwd app react@^19 react-dom@^19
bun add --cwd app --dev @types/react@^19 @types/react-dom@^19
```

Expected: `app/package.json` shows `"react": "^19.x.x"`, `"react-dom": "^19.x.x"`, devDeps updated. `bun.lock` updated.

- [ ] **Step 1.3: Typecheck — surface ref-as-prop churn**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck
```

Expected: typecheck may flag a handful of files where:
- `forwardRef<HTMLDivElement, Props>` patterns now have stricter `ref` prop typing.
- `React.RefObject<T>` vs `React.RefObject<T | null>` distinctions.
- `JSX.IntrinsicElements` references (now `React.JSX.IntrinsicElements`).

Fix each error reported — these are mechanical. Do NOT rewrite `forwardRef` to ref-as-prop yet (that's a future cleanup); just adjust types to satisfy the new strictness.

- [ ] **Step 1.4: Run lint and tests**

```bash
cd ~/Documents/GitHub/master-db
bun run lint && bun test
```

Expected: both green.

- [ ] **Step 1.5: Smoke test the dev server in a browser**

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Open the printed local URL. Verify visually:
- Layout renders (sidebar + main pane).
- Theme toggle works (light/dark).
- A dialog opens (try the keyboard shortcut for "Quick Add").
- Sidebar nav clicks switch views.
- A task list renders without React errors in the browser console.

Stop the dev server (`Ctrl+C`).

- [ ] **Step 1.6: Commit and PR**

```bash
cd ~/Documents/GitHub/master-db
git add app/package.json app/bun.lock app/src
git status
git commit --message "chore(deps): bump React to 19 + adjust types

@types/react@19 tightened ref typings. Mechanical fixes to satisfy
typecheck. No behavior changes."
git push -u origin agentic-engine-ux/react-19
gh pr create --title "chore(deps): bump React to 19" --body "Standalone prereq for agentic engine UX work. Mechanical type adjustments only."
```

Expected: PR opens. Merge after review.

---

## Task 2: PR 2 — Tailwind v3 → v4 migration

**Goal:** Migrate `app/` to Tailwind v4 + replace `tailwindcss-animate` with `tw-animate-css`. Standalone PR. ~half day.

**Files:**
- Modify: `app/package.json` (deps)
- Delete: `app/tailwind.config.js` (replaced by `@theme` in CSS)
- Delete: `app/postcss.config.js` (replaced by `@tailwindcss/vite` plugin)
- Modify: `app/vite.config.ts` (add Vite plugin)
- Modify: `app/src/index.css` (rewrite to `@import "tailwindcss"`, `@import "tw-animate-css"`, `@theme` block)
- Possibly modify: shadcn components if classes need fixing — only if the migration tool flags real issues.

**Branch:** `agentic-engine-ux/tailwind-v4`

- [ ] **Step 2.1: Create branch (depends on Task 1 merged)**

```bash
cd ~/Documents/GitHub/master-db
git checkout main && git pull --ff-only
git checkout -b agentic-engine-ux/tailwind-v4
```

- [ ] **Step 2.2: Run the official migration tool**

```bash
cd ~/Documents/GitHub/master-db/app
bunx @tailwindcss/upgrade@latest
```

Expected: the tool prints what it changed — `package.json`, `vite.config.ts`, `index.css`, possibly individual classnames across components. Read the output carefully.

- [ ] **Step 2.3: Replace `tailwindcss-animate` with `tw-animate-css`**

```bash
cd ~/Documents/GitHub/master-db
bun remove --cwd app tailwindcss-animate
bun add --cwd app tw-animate-css
```

Now update `app/src/index.css`. Add this line near the top, after `@import "tailwindcss";`:

```css
@import "tw-animate-css";
```

If the upgrade tool already added `@import "tailwindcss";`, place `@import "tw-animate-css";` immediately below it. Remove any `@plugin "tailwindcss-animate";` line if the upgrade tool inserted one.

- [ ] **Step 2.4: Verify the `@theme` block in `index.css`**

Open `app/src/index.css`. Confirm CSS-variable theme tokens live in a `@theme` block now (this is what the migration tool emits — verify it didn't miss anything from the old `tailwind.config.js`). Specifically, check that the shadcn semantic tokens (`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--primary`, `--muted`, `--muted-foreground`, `--accent`, `--border`, `--input`, `--ring`, `--radius`, `--sidebar-*` if any) are all defined.

- [ ] **Step 2.5: Typecheck**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck
```

Expected: green. The Tailwind migration is mostly CSS, so typechecker errors here would be unrelated.

- [ ] **Step 2.6: Run lint and tests**

```bash
cd ~/Documents/GitHub/master-db
bun run lint && bun test
```

Expected: both green.

- [ ] **Step 2.7: Smoke test animations in a browser**

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Verify visually:
- Open a `Popover` (any project options menu) — fade-in animation plays.
- Open a `Sheet` (sidebar collapse/expand if available, else any drawer) — slide animation plays.
- Open a `Tooltip` — fade animation plays.
- Open a `Dialog` (Quick Add) — zoom-in / fade-in plays.
- Open `Dropdown Menu` (any task row dropdown) — slide animation plays.
- Toggle a `Checkbox` — visual state changes cleanly.
- Open a `Select` (priority dialog) — animation plays.
- Toggle the sidebar — slide animation plays.

If any animation is broken, the migration didn't fully translate the `data-[state=open]:animate-in` patterns. Fix by re-checking that `tw-animate-css` is imported and the relevant component still uses the `animate-in` / `fade-in-*` / `slide-in-from-*` / `zoom-in-*` class names.

Stop the dev server.

- [ ] **Step 2.8: Commit and PR**

```bash
cd ~/Documents/GitHub/master-db
git add app/package.json app/bun.lock app/vite.config.ts app/src/index.css
git rm app/tailwind.config.js app/postcss.config.js 2>/dev/null || true
git add app/src/components/ 2>/dev/null
git status
git commit --message "chore(build): migrate to Tailwind v4 + tw-animate-css

Run @tailwindcss/upgrade. Replace postcss.config + tailwind.config with
@tailwindcss/vite plugin and @theme block in index.css. Swap
tailwindcss-animate for tw-animate-css to preserve animate-in / fade-in /
slide-in / zoom-in class set under v4."
git push -u origin agentic-engine-ux/tailwind-v4
gh pr create --title "chore(build): Tailwind v3 → v4" --body "Standalone prereq for agentic engine UX work. Migrates to v4 + drop-in tw-animate-css to keep all shadcn animate classes working unchanged."
```

Expected: PR opens. Merge after review.

---

## Task 3: Phase 1 Step A — Spike: validate assistant-ui + Convex + data-proposal

**Goal:** 1-day proof that `@assistant-ui/react`'s `ExternalStoreRuntime` cleanly maps to Convex reactive queries and our custom `data-proposal` message-part shape. Decision gate at the end: continue with assistant-ui OR fall back to Vercel AI Elements.

**Branch:** `agentic-engine-ux-spike` (throwaway — gets killed after the gate, win or lose).

**Prerequisites:** Tasks 1 and 2 merged. Server agent's `convex/agentic/` queries + mutations merged.

**Files:**
- Create: `app/src/spike/AgentSpike.tsx`
- Modify: `app/src/App.tsx` (add temporary `/spike` route)
- Create: `convex/agentic/dev/seed.ts` (if it doesn't exist yet — coordinate with server agent)
- Modify: `app/package.json` (deps)

- [ ] **Step 3.1: Create branch + install deps**

```bash
cd ~/Documents/GitHub/master-db
git checkout main && git pull --ff-only
git checkout -b agentic-engine-ux-spike
bun add --cwd app @assistant-ui/react react-markdown remark-gfm
```

Expected: `app/package.json` shows the three new deps.

- [ ] **Step 3.2: Create the seed mutation script**

Check first if `convex/agentic/dev/seed.ts` already exists (the server agent may have shipped one). If yes, skip to Step 3.3 and reuse what's there.

If not, create `convex/agentic/dev/seed.ts`:

```ts
import { mutation } from "../../_generated/server"

export const seedSpikeThread = mutation({
  args: {},
  handler: async (ctx) => {
    const entity_ref = "todoist:task:spike-001"

    // Clear any prior seed for this entity_ref
    const priorRun = await ctx.db
      .query("agenticRuns")
      .withIndex("by_entity_ref", (q) => q.eq("entity_ref", entity_ref))
      .unique()
    if (priorRun) await ctx.db.delete(priorRun._id)
    for (const m of await ctx.db
      .query("agenticThreadMessages")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", entity_ref),
      )
      .collect()) {
      await ctx.db.delete(m._id)
    }
    for (const a of await ctx.db
      .query("agenticThreadActivities")
      .withIndex("by_entity_ref_and_sequence", (q) =>
        q.eq("entity_ref", entity_ref),
      )
      .collect()) {
      await ctx.db.delete(a._id)
    }

    // Upsert run
    await ctx.db.insert("agenticRuns", {
      entity_ref,
      entity_type: "todoist_task",
      entity_id: "spike-001",
      backend: "claude_sdk",
      resume_cursor: null,
      status: "awaiting_decision",
      last_message_id: null,
      last_run_id: "01HSPIKE",
      last_traceparent: null,
      updated_at: Date.now(),
    })

    // Seed thread: user_message → reasoning → tool_call → assistant_message → proposal
    let seq = 0

    seq++
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref, sequence: seq, run_id: "01HSPIKE",
      kind: "user_message",
      body_markdown: "What should I do with this task?",
      proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
    })

    seq++
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref, sequence: seq, run_id: "01HSPIKE",
      kind: "reasoning",
      body_markdown: "Checking the task content and any linked notes…",
      proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
    })

    seq++
    await ctx.db.insert("agenticThreadActivities", {
      entity_ref, sequence: seq, run_id: "01HSPIKE",
      kind: "tool_call",
      name: "search_obsidian",
      input_json: { query: "venue change June 14" },
      output_json: { hits: 2 },
      status: "ok",
      resolved_at: Date.now(),
    })

    seq++
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref, sequence: seq, run_id: "01HSPIKE",
      kind: "assistant_message",
      body_markdown: "Found two relevant notes. Drafting options.",
      proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
    })

    seq++
    await ctx.db.insert("agenticThreadMessages", {
      entity_ref, sequence: seq, run_id: "01HSPIKE",
      kind: "proposal",
      body_markdown: null,
      proposal_json: {
        kind: "proposal",
        summary: "Sarah's email about June 14 venue. Three viable paths.",
        findings: [
          "230 confirmed RSVPs",
          "Studio 51 unavailable",
          "June 21 is open",
        ],
        options: [
          { id: "a", label: "Confirm Brooklyn Bowl fallback",
            description: "Reply confirming the BB fallback. Keeps June 14 date.",
            confidence: 0.6, reversibility: "moderate",
            side_effects: ["sends email", "re-issues 230 tickets"] },
          { id: "b", label: "Propose pushing to June 21",
            description: "Reply asking Sarah to move to June 21. Studio 51 confirms open.",
            confidence: 0.85, reversibility: "trivial",
            side_effects: ["sends email", "writes Airtable"] },
          { id: "c", label: "Ask Sarah to clarify her preference",
            description: "Reply asking which she prefers.",
            confidence: 0.95, reversibility: "trivial",
            side_effects: ["sends email"] },
        ],
        recommended_option_id: "b",
        free_text_allowed: true,
      },
      error_json: null, token_usage: null, checkpoint_id: "ck-spike-1",
    })
  },
})
```

- [ ] **Step 3.3: Run the seed**

```bash
cd ~/Documents/GitHub/master-db
bunx convex dev --once
bunx convex run agentic/dev/seed:seedSpikeThread
```

Expected: prints `null`. Visit the Convex dashboard to confirm `agenticRuns` and `agenticThreadMessages` rows exist for `entity_ref = "todoist:task:spike-001"`.

- [ ] **Step 3.4: Build the spike component**

Create `app/src/spike/AgentSpike.tsx`:

```tsx
import { useQuery } from "convex/react"
import { useMemo, useState } from "react"
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react"
import { Thread } from "@assistant-ui/react"
import { api } from "@/convex/_generated/api"

const SPIKE_ENTITY_REF = "todoist:task:spike-001"

type ThreadRow = {
  _id: string
  row_type: "message" | "activity"
  sequence: number
  run_id: string
  kind: string
  body_markdown?: string | null
  proposal_json?: unknown
  name?: string
  input_json?: unknown
  output_json?: unknown
  status?: string
}

function convertRow(row: ThreadRow): ThreadMessageLike {
  if (row.row_type === "message") {
    if (row.kind === "user_message") {
      return { id: row._id, role: "user", content: [{ type: "text", text: row.body_markdown ?? "" }] }
    }
    if (row.kind === "assistant_message") {
      return { id: row._id, role: "assistant", content: [{ type: "text", text: row.body_markdown ?? "" }] }
    }
    if (row.kind === "proposal") {
      return {
        id: row._id,
        role: "assistant",
        content: [{ type: "data-proposal", data: row.proposal_json } as never],
      }
    }
    if (row.kind === "reasoning") {
      return { id: row._id, role: "assistant", content: [{ type: "reasoning", text: row.body_markdown ?? "" } as never] }
    }
  }
  if (row.row_type === "activity" && row.kind === "tool_call") {
    return {
      id: row._id,
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: row._id, toolName: row.name ?? "unknown",
                  args: row.input_json, result: row.output_json } as never],
    }
  }
  return { id: row._id, role: "assistant", content: [{ type: "text", text: `[unhandled: ${row.kind}]` }] }
}

export function AgentSpike() {
  const rows = useQuery(api.agentic.queries.getThread.default, { entity_ref: SPIKE_ENTITY_REF }) as ThreadRow[] | undefined
  const run = useQuery(api.agentic.queries.getRun.default, { entity_ref: SPIKE_ENTITY_REF })
  const [running] = useState(false)

  const messages = useMemo(() => (rows ?? []).map(convertRow), [rows])

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: running || run?.status === "discovering" || run?.status === "executing",
    convertMessage: (m) => m,
    onNew: async (msg) => {
      console.log("onNew (spike no-op):", msg)
    },
    onCancel: async () => {
      console.log("onCancel (spike no-op)")
    },
  })

  if (rows === undefined || run === undefined) return <div style={{ padding: 20 }}>Loading…</div>

  return (
    <div style={{ height: "100vh", padding: 20 }}>
      <h1>Agent Spike</h1>
      <p>entity_ref: <code>{SPIKE_ENTITY_REF}</code> · status: <code>{run?.status ?? "(no run)"}</code> · rows: {rows.length}</p>
      <hr />
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread.Root>
          <Thread.Viewport>
            <Thread.Messages
              components={{
                UserMessage: (p) => <div style={{ textAlign: "right", margin: "8px 0" }}>{p.children}</div>,
                AssistantMessage: (p) => <div style={{ margin: "8px 0" }}>{p.children}</div>,
                MessagePartByType: {
                  "data-proposal": ({ part }) => (
                    <pre style={{ background: "#0a0a0a", color: "#a0e8a0", padding: 12, borderRadius: 8, overflow: "auto" }}>
                      {JSON.stringify((part as { data: unknown }).data, null, 2)}
                    </pre>
                  ),
                  "tool-call": ({ part }) => (
                    <details style={{ margin: "4px 0", padding: 6, border: "1px solid #333", borderRadius: 6 }}>
                      <summary>tool · {(part as { toolName: string }).toolName}</summary>
                      <pre>{JSON.stringify(part, null, 2)}</pre>
                    </details>
                  ),
                } as never,
              }}
            />
          </Thread.Viewport>
        </Thread.Root>
      </AssistantRuntimeProvider>
    </div>
  )
}
```

Note: the exact import names from `@assistant-ui/react` for `Thread`, `MessagePartByType`, the `useExternalStoreRuntime` signature, and the message-part typing may have moved between minor versions. If the imports above fail, consult the current docs at `assistant-ui.com/docs/runtimes/custom/external-store` and adjust — the *shape* of the integration (messages array in, runtime out, parts rendered by type) is stable; only naming churns.

- [ ] **Step 3.5: Mount the spike at `/spike`**

Modify `app/src/App.tsx` to add a temporary route. Find the `<Router>` section and add a Wouter `<Route>` for `/spike`. Use the existing Wouter import:

```tsx
import { Route, Router } from "wouter"
import { AgentSpike } from "@/spike/AgentSpike"

// Inside <Router>:
//   <Route path="/spike" component={AgentSpike} />
//   <Route> ... existing layout
```

Place the spike route BEFORE the catch-all that renders `<Layout />` so it wins routing.

- [ ] **Step 3.6: Run the dev server and visit `/spike`**

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Open the printed URL with `/spike` appended.

**Decision gate** (the entire purpose of the spike):

1. Does the thread render at all? (5 rows visible: user message bubble, reasoning blob, tool-call card, assistant message bubble, proposal JSON pretty-printed.)
2. Does `isRunning` correctly stay false (since seed has `status: "awaiting_decision"`)?
3. Does the `data-proposal` custom part render via the `MessagePartByType` map?
4. Does a `tool-call` part render via the same map?
5. If you re-run `seedSpikeThread` (it deletes + re-inserts), does the Convex subscription push new rows and the UI rerender without manual refresh?

If all five are YES → assistant-ui works for our shape. Proceed to Task 4. Kill the spike branch.

If any are NO and aren't trivially fixable by reading the assistant-ui docs → **abort assistant-ui, switch to Vercel AI Elements**. Open a follow-up brainstorm + spec revision; do NOT continue this plan as-written.

- [ ] **Step 3.7: Kill the spike branch**

```bash
cd ~/Documents/GitHub/master-db
git checkout main
git branch -D agentic-engine-ux-spike
# The seed mutation in convex/agentic/dev/seed.ts STAYS — Task 12 reuses it.
# If you created it in this task and want to preserve it, cherry-pick that one file
# to a small "chore(convex): add agentic dev seed" commit on main before branch deletion.
```

Stop the dev server.

---

## Task 4: Commit 1 (production build) — Setup, scaffolding, attribution

**Goal:** Land all the new dependencies, create the `components/agent/` skeleton, add MIT attribution for t3code patterns. No real components yet — just the structure the next 10 commits fill in.

**Branch:** `agentic-engine-ux` (long-lived; tasks 4–14 all commit to this branch).

**Files:**
- Modify: `app/package.json` (add deps)
- Create: `app/src/components/agent/index.ts`
- Create: `app/src/components/agent/AgentDrawer.tsx` (stub)
- Create: `app/src/components/agent/AgentTranscript.tsx` (stub)
- Create: `app/src/components/agent/WorkLogGroup.tsx` (stub)
- Create: `app/src/components/agent/ToolCallCard.tsx` (stub)
- Create: `app/src/components/agent/ProposalCard.tsx` (stub)
- Create: `app/src/components/agent/ProposalOptionRow.tsx` (stub)
- Create: `app/src/components/agent/AgentComposer.tsx` (stub)
- Create: `app/src/components/agent/ThinkingIndicator.tsx` (stub)
- Create: `app/src/components/agent/StatusPill.tsx` (stub)
- Create: `app/src/components/agent/ErrorState.tsx` (stub)
- Create: `app/src/components/agent/RewindButton.tsx` (stub)
- Create: `app/src/contexts/AgentDrawerContext.tsx` (stub)
- Create: `app/src/lib/agent/tool-registry.ts` (stub)
- Create: `THIRD_PARTY_NOTICES.md` (at repo root)

- [ ] **Step 4.1: Create branch**

```bash
cd ~/Documents/GitHub/master-db
git checkout main && git pull --ff-only
git checkout -b agentic-engine-ux
```

- [ ] **Step 4.2: Install runtime deps**

```bash
cd ~/Documents/GitHub/master-db
bun add --cwd app @assistant-ui/react react-markdown remark-gfm
bun add --cwd app --dev @testing-library/react
```

Expected: 4 new entries in `app/package.json`.

- [ ] **Step 4.3: Create `THIRD_PARTY_NOTICES.md`**

`/Users/mimen1994/Documents/GitHub/master-db/THIRD_PARTY_NOTICES.md`:

```markdown
# Third-Party Notices

## Patterns adapted from pingdotgg/t3code

The following UI patterns in `app/src/components/agent/` are reimplemented in our own code from designs found in [pingdotgg/t3code](https://github.com/pingdotgg/t3code). t3code is MIT-licensed. Files that lift a pattern carry a top-of-file comment naming the source.

Patterns lifted (paraphrased; no source copied):

- **Work-log grouping** — coalesce consecutive reasoning + tool-call rows into one collapsible section (`apps/web/src/components/chat/MessagesTimeline.logic.ts` at lift time).
- **4-button decision gradient** — Cancel turn / Decline / Always allow / Approve, with disable-on-pending (`apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`).
- **3-dot pulse + self-ticking elapsed timer via direct DOM mutation** — avoids re-render storms on long-running turns (`apps/web/src/components/chat/MessagesTimeline.tsx`, `WorkingTimelineRow`).
- **Status-pill stack** — agent state + downstream artifact state on one row, semantic colors, `animate-pulse` for live state (`apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/ThreadStatusIndicators.tsx`).

Lift commit SHA for reference: (record at lift time, leave blank until populated).

### MIT License (t3code)

[Reproduce full MIT license text here — verbatim from the t3code repo's LICENSE file at lift time. Use `gh api repos/pingdotgg/t3code/license --jq .content | base64 -d` to fetch.]
```

Then fetch the MIT text:

```bash
cd ~/Documents/GitHub/master-db
gh api repos/pingdotgg/t3code/license --jq .content | base64 -d
```

Copy the printed text into the `### MIT License (t3code)` section.

Also record the current t3code main commit SHA:

```bash
gh api repos/pingdotgg/t3code/commits/main --jq .sha
```

Paste into the "Lift commit SHA for reference" line.

- [ ] **Step 4.4: Create the components/agent/ skeleton**

Each stub file is one export of an empty component. Example: `app/src/components/agent/AgentDrawer.tsx`:

```tsx
// Stub — implementation lands in Task 6.
export function AgentDrawer() {
  return null
}
```

Create all 11 component stubs with the same shape (just different component name per the file list above). Each named export matches the filename.

For the two non-component stubs:

`app/src/contexts/AgentDrawerContext.tsx`:

```tsx
// Stub — implementation lands in Task 6.
import { createContext } from "react"

export const AgentDrawerContext = createContext<null>(null)
```

`app/src/lib/agent/tool-registry.ts`:

```ts
// Tool-name → custom renderer override. Empty in v1; per-tool variants are a
// reserved seam (see spec §"Reserved seams"). Day-2 specializations register
// here without touching the transcript.
export const toolRegistry: Record<string, never> = {}
```

`app/src/components/agent/index.ts`:

```ts
export { AgentDrawer } from "./AgentDrawer"
export { AgentTranscript } from "./AgentTranscript"
export { WorkLogGroup } from "./WorkLogGroup"
export { ToolCallCard } from "./ToolCallCard"
export { ProposalCard } from "./ProposalCard"
export { ProposalOptionRow } from "./ProposalOptionRow"
export { AgentComposer } from "./AgentComposer"
export { ThinkingIndicator } from "./ThinkingIndicator"
export { StatusPill } from "./StatusPill"
export { ErrorState } from "./ErrorState"
export { RewindButton } from "./RewindButton"
```

- [ ] **Step 4.5: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

Expected: all green. Stubs are intentionally trivial.

- [ ] **Step 4.6: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/package.json app/bun.lock app/src/components/agent app/src/contexts/AgentDrawerContext.tsx app/src/lib/agent/tool-registry.ts THIRD_PARTY_NOTICES.md
git status
git commit --message "feat(agent): scaffold components/agent/ + deps + t3code attribution

Add @assistant-ui/react, react-markdown, remark-gfm, @testing-library/react.
Empty stubs for 11 components, AgentDrawerContext, tool-registry, and the
THIRD_PARTY_NOTICES.md with the MIT attribution for t3code patterns.
Implementation lands in subsequent commits."
```

---

## Task 5: Commit 2 (production build) — Pure utilities (convertMessage, proposalToParts, workLogGrouping)

**Goal:** Land the three pure-function utilities that everything else depends on, exhaustively unit-tested without DOM.

**Files:**
- Create: `app/src/lib/agent/convertMessage.ts`
- Create: `app/src/lib/agent/convertMessage.test.ts`
- Create: `app/src/lib/agent/proposalToParts.ts`
- Create: `app/src/lib/agent/proposalToParts.test.ts`
- Create: `app/src/lib/agent/workLogGrouping.ts`
- Create: `app/src/lib/agent/workLogGrouping.test.ts`

The Convex `getThread` query (server plan Task 8) returns rows like:

```ts
type ThreadRow =
  | (MessageDoc & { row_type: "message" })
  | (ActivityDoc & { row_type: "activity" })
```

ordered by `sequence`. Our utilities convert these to assistant-ui `ThreadMessage` shapes and identify work-log groups.

### Task 5a: convertMessage

- [ ] **Step 5a.1: Write failing tests**

`app/src/lib/agent/convertMessage.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { convertMessage, type ThreadRow } from "./convertMessage"

function row(over: Partial<ThreadRow>): ThreadRow {
  return {
    _id: "r1",
    row_type: "message",
    sequence: 1,
    run_id: "01H",
    kind: "user_message",
    body_markdown: "hi",
    proposal_json: null,
    error_json: null,
    token_usage: null,
    checkpoint_id: null,
    ...over,
  } as ThreadRow
}

describe("convertMessage", () => {
  test("user_message → user role, single text part", () => {
    const m = convertMessage(row({ kind: "user_message", body_markdown: "hello" }))
    expect(m.role).toBe("user")
    expect(m.content).toEqual([{ type: "text", text: "hello" }])
  })

  test("assistant_message → assistant role, single text part", () => {
    const m = convertMessage(row({ kind: "assistant_message", body_markdown: "world" }))
    expect(m.role).toBe("assistant")
    expect(m.content).toEqual([{ type: "text", text: "world" }])
  })

  test("proposal → assistant role, data-proposal part", () => {
    const p = { kind: "proposal", summary: "x", options: [], free_text_allowed: true }
    const m = convertMessage(row({ kind: "proposal", body_markdown: null, proposal_json: p }))
    expect(m.role).toBe("assistant")
    expect(m.content[0]).toMatchObject({ type: "data-proposal", data: p })
  })

  test("execution_result → assistant role, data-execution-result part", () => {
    const m = convertMessage(row({ kind: "execution_result", body_markdown: "✓ done" }))
    expect(m.content[0]).toMatchObject({ type: "data-execution-result", data: { body_markdown: "✓ done" } })
  })

  test("error → assistant role, data-error part", () => {
    const errPayload = { message: "boom" }
    const m = convertMessage(row({ kind: "error", body_markdown: null, error_json: errPayload }))
    expect(m.content[0]).toMatchObject({ type: "data-error", data: errPayload })
  })

  test("reasoning → assistant role, data-reasoning part (will be grouped, not rendered alone)", () => {
    const m = convertMessage(row({ kind: "reasoning", body_markdown: "thinking…" }))
    expect(m.content[0]).toMatchObject({ type: "data-reasoning", data: { body_markdown: "thinking…" } })
  })

  test("activity tool_call → assistant role, data-tool-call part", () => {
    const m = convertMessage({
      _id: "a1", row_type: "activity", sequence: 5, run_id: "01H",
      kind: "tool_call", name: "search_obsidian",
      input_json: { q: "x" }, output_json: { hits: 2 }, status: "ok", resolved_at: null,
    } as ThreadRow)
    expect(m.content[0]).toMatchObject({
      type: "data-tool-call",
      data: { name: "search_obsidian", status: "ok", input: { q: "x" }, output: { hits: 2 } },
    })
  })

  test("body_markdown null on prose kinds → empty string text", () => {
    const m = convertMessage(row({ kind: "assistant_message", body_markdown: null }))
    expect(m.content[0]).toEqual({ type: "text", text: "" })
  })

  test("id is the Convex _id", () => {
    expect(convertMessage(row({ _id: "abc" })).id).toBe("abc")
  })
})
```

- [ ] **Step 5a.2: Run test, expect failure**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/convertMessage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5a.3: Implement convertMessage**

`app/src/lib/agent/convertMessage.ts`:

```ts
import type { ThreadMessageLike } from "@assistant-ui/react"

export type ThreadRow = {
  _id: string
  row_type: "message" | "activity"
  sequence: number
  run_id: string
  kind: string
  body_markdown?: string | null
  proposal_json?: unknown
  error_json?: unknown
  token_usage?: unknown
  checkpoint_id?: string | null
  name?: string
  input_json?: unknown
  output_json?: unknown
  status?: string
  resolved_at?: number | null
}

export function convertMessage(row: ThreadRow): ThreadMessageLike {
  if (row.row_type === "message") {
    switch (row.kind) {
      case "user_message":
        return { id: row._id, role: "user",
          content: [{ type: "text", text: row.body_markdown ?? "" }] }
      case "assistant_message":
        return { id: row._id, role: "assistant",
          content: [{ type: "text", text: row.body_markdown ?? "" }] }
      case "proposal":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-proposal", data: row.proposal_json } as never] }
      case "execution_result":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-execution-result",
            data: { body_markdown: row.body_markdown ?? "" } } as never] }
      case "error":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-error", data: row.error_json } as never] }
      case "reasoning":
        return { id: row._id, role: "assistant",
          content: [{ type: "data-reasoning",
            data: { body_markdown: row.body_markdown ?? "" } } as never] }
    }
  }
  if (row.row_type === "activity" && row.kind === "tool_call") {
    return { id: row._id, role: "assistant",
      content: [{ type: "data-tool-call",
        data: {
          name: row.name ?? "unknown",
          status: row.status ?? "pending",
          input: row.input_json,
          output: row.output_json,
        } } as never] }
  }
  return { id: row._id, role: "assistant",
    content: [{ type: "text", text: `[unhandled kind: ${row.kind}]` }] }
}
```

- [ ] **Step 5a.4: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/convertMessage.test.ts
```

Expected: PASS.

### Task 5b: proposalToParts

This file holds the Proposal type alias + a type guard. It centralizes the shape `data-proposal` parts carry so consumer components don't import the raw `unknown`.

- [ ] **Step 5b.1: Write failing tests**

`app/src/lib/agent/proposalToParts.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { isProposal, type Proposal } from "./proposalToParts"

const validProposal: Proposal = {
  kind: "proposal",
  summary: "x",
  options: [
    { id: "a", label: "A", description: "d", confidence: 0.5, reversibility: "trivial" },
  ],
  free_text_allowed: true,
}

describe("isProposal", () => {
  test("accepts a minimal proposal", () => {
    expect(isProposal(validProposal)).toBe(true)
  })

  test("rejects null", () => {
    expect(isProposal(null)).toBe(false)
  })

  test("rejects missing kind", () => {
    expect(isProposal({ ...validProposal, kind: undefined })).toBe(false)
  })

  test("rejects unknown kind", () => {
    expect(isProposal({ ...validProposal, kind: "garbage" })).toBe(false)
  })

  test("rejects non-array options", () => {
    expect(isProposal({ ...validProposal, options: "nope" })).toBe(false)
  })

  test("rejects option missing required field", () => {
    expect(isProposal({
      ...validProposal,
      options: [{ id: "a", label: "A" }],
    })).toBe(false)
  })

  test("accepts a clarification with question", () => {
    expect(isProposal({
      kind: "clarification",
      summary: "?",
      question: "Which?",
      options: [],
      free_text_allowed: true,
    })).toBe(true)
  })
})
```

- [ ] **Step 5b.2: Run test, expect failure**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/proposalToParts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5b.3: Implement**

`app/src/lib/agent/proposalToParts.ts`:

```ts
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
  return (
    typeof o.kind === "string" &&
    PROPOSAL_KINDS.has(o.kind) &&
    typeof o.summary === "string" &&
    typeof o.free_text_allowed === "boolean" &&
    Array.isArray(o.options) &&
    (o.options as unknown[]).every(isOption)
  )
}
```

- [ ] **Step 5b.4: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/proposalToParts.test.ts
```

Expected: PASS.

### Task 5c: workLogGrouping

This is the t3code-inspired algorithm: walk an interleaved row array, coalesce consecutive reasoning + tool_call rows (within the same run_id) into one group. Other kinds break the group.

- [ ] **Step 5c.1: Write failing tests**

`app/src/lib/agent/workLogGrouping.test.ts`:

```ts
import { describe, expect, test } from "vitest"
import { groupWorkLog, type WorkLogTimelineItem } from "./workLogGrouping"
import type { ThreadRow } from "./convertMessage"

function msg(seq: number, kind: string, run_id = "r1"): ThreadRow {
  return { _id: `m${seq}`, row_type: "message", sequence: seq, run_id, kind,
    body_markdown: "x", proposal_json: null, error_json: null,
    token_usage: null, checkpoint_id: null }
}
function act(seq: number, kind: string, run_id = "r1"): ThreadRow {
  return { _id: `a${seq}`, row_type: "activity", sequence: seq, run_id, kind,
    name: "Read", input_json: {}, output_json: {}, status: "ok", resolved_at: null }
}

describe("groupWorkLog", () => {
  test("empty array → empty result", () => {
    expect(groupWorkLog([])).toEqual([])
  })

  test("single user_message → single item, no group", () => {
    const r = groupWorkLog([msg(1, "user_message")])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ type: "row" })
  })

  test("consecutive reasoning + tool_call → grouped", () => {
    const r = groupWorkLog([
      msg(1, "user_message"),
      msg(2, "reasoning"),
      act(3, "tool_call"),
      act(4, "tool_call"),
      msg(5, "reasoning"),
      msg(6, "assistant_message"),
    ])
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ type: "row" })
    expect(r[1]).toMatchObject({ type: "group", items: expect.any(Array) })
    expect((r[1] as Extract<WorkLogTimelineItem, { type: "group" }>).items).toHaveLength(4)
    expect(r[2]).toMatchObject({ type: "row" })
  })

  test("run_id change breaks the group", () => {
    const r = groupWorkLog([
      msg(1, "reasoning", "r1"),
      msg(2, "reasoning", "r2"),
    ])
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ type: "row" })
    expect(r[1]).toMatchObject({ type: "row" })
  })

  test("proposal between reasoning blocks breaks the group", () => {
    const r = groupWorkLog([
      msg(1, "reasoning"),
      msg(2, "proposal"),
      msg(3, "reasoning"),
    ])
    expect(r).toHaveLength(3)
    expect(r.every((x) => x.type === "row")).toBe(true)
  })

  test("group preserves first/last sequence + run_id for header rendering", () => {
    const r = groupWorkLog([msg(2, "reasoning"), act(3, "tool_call")])
    const g = r[0] as Extract<WorkLogTimelineItem, { type: "group" }>
    expect(g.type).toBe("group")
    expect(g.firstSequence).toBe(2)
    expect(g.lastSequence).toBe(3)
    expect(g.run_id).toBe("r1")
  })

  test("single reasoning row is still a 1-item group (consistent surface for consumers)", () => {
    const r = groupWorkLog([msg(1, "reasoning")])
    expect(r[0]).toMatchObject({ type: "group", items: [expect.objectContaining({ _id: "m1" })] })
  })
})
```

- [ ] **Step 5c.2: Run test, expect failure**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/workLogGrouping.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5c.3: Implement**

`app/src/lib/agent/workLogGrouping.ts`:

```ts
// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.logic.ts

import type { ThreadRow } from "./convertMessage"

export type WorkLogTimelineItem =
  | { type: "row"; row: ThreadRow }
  | {
      type: "group"
      items: ThreadRow[]
      firstSequence: number
      lastSequence: number
      run_id: string
    }

const PROCESS_KINDS = new Set(["reasoning", "tool_call"])

function isProcessRow(r: ThreadRow): boolean {
  return PROCESS_KINDS.has(r.kind)
}

export function groupWorkLog(rows: ThreadRow[]): WorkLogTimelineItem[] {
  const out: WorkLogTimelineItem[] = []
  let buffer: ThreadRow[] = []

  function flushGroup() {
    if (buffer.length === 0) return
    out.push({
      type: "group",
      items: buffer,
      firstSequence: buffer[0].sequence,
      lastSequence: buffer[buffer.length - 1].sequence,
      run_id: buffer[0].run_id,
    })
    buffer = []
  }

  for (const r of rows) {
    if (isProcessRow(r) && (buffer.length === 0 || buffer[buffer.length - 1].run_id === r.run_id)) {
      buffer.push(r)
      continue
    }
    flushGroup()
    out.push({ type: "row", row: r })
  }
  flushGroup()
  return out
}
```

- [ ] **Step 5c.4: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/workLogGrouping.test.ts
```

Expected: PASS.

- [ ] **Step 5d: Validate and commit**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
git add app/src/lib/agent
git commit --message "feat(agent): pure utilities (convertMessage, proposalToParts, workLogGrouping)

Three pure transformations Convex rows → assistant-ui shapes, with
exhaustive unit tests. workLogGrouping is the t3code-derived algorithm
that coalesces consecutive reasoning + tool_call rows (within one
run_id) into one collapsible group."
```

Expected: typecheck/lint/test all green.

---

## Task 6: Commit 3 (production build) — Drawer shell, context, trigger, kbd binding

**Goal:** The drawer opens and closes. URL param syncs. Trigger button on a task and `g a` keybinding both work. Body is still a placeholder.

**Files:**
- Modify (replace stub): `app/src/contexts/AgentDrawerContext.tsx`
- Create: `app/src/contexts/AgentDrawerContext.test.tsx`
- Modify (replace stub): `app/src/components/agent/AgentDrawer.tsx`
- Create: `app/src/components/agent/AgentDrawer.test.tsx`
- Create: `app/src/hooks/useAgentKeybindings.ts`
- Create: `app/src/hooks/useAgentKeybindings.test.tsx`
- Modify: `app/src/App.tsx` (mount `AgentDrawerProvider` and render `<AgentDrawer />`)
- Modify: `app/src/components/list-items/TaskListItem.tsx` (add "Open Agent" button — find an existing actions row and add it)

- [ ] **Step 6.1: Implement AgentDrawerContext (and tests)**

`app/src/contexts/AgentDrawerContext.test.tsx`:

```tsx
import { describe, expect, test } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { AgentDrawerProvider, useAgentDrawer } from "./AgentDrawerContext"

describe("AgentDrawerContext", () => {
  test("opens with an entity_ref and closes", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AgentDrawerProvider>{children}</AgentDrawerProvider>
    )
    const { result } = renderHook(() => useAgentDrawer(), { wrapper })
    expect(result.current.activeEntityRef).toBeNull()
    expect(result.current.isOpen).toBe(false)

    act(() => result.current.open("todoist:task:1"))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.activeEntityRef).toBe("todoist:task:1")

    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.activeEntityRef).toBeNull()
  })
})
```

`app/src/contexts/AgentDrawerContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactNode } from "react"

type AgentDrawerCtx = {
  isOpen: boolean
  activeEntityRef: string | null
  open: (entity_ref: string) => void
  close: () => void
}

const Ctx = createContext<AgentDrawerCtx | null>(null)

export function AgentDrawerProvider({ children }: { children: ReactNode }) {
  const [activeEntityRef, setActiveEntityRef] = useState<string | null>(null)

  const open = useCallback((entity_ref: string) => {
    setActiveEntityRef(entity_ref)
    const url = new URL(window.location.href)
    url.searchParams.set("agent", entity_ref)
    window.history.replaceState({}, "", url.toString())
  }, [])

  const close = useCallback(() => {
    setActiveEntityRef(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("agent")
    window.history.replaceState({}, "", url.toString())
  }, [])

  // Sync from URL on mount + popstate.
  // (Full Wouter integration arrives in Step 6.5 — for now, just initial read.)
  useMemo(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("agent")
    if (fromUrl) setActiveEntityRef(fromUrl)
  }, [])

  const value: AgentDrawerCtx = { isOpen: activeEntityRef !== null, activeEntityRef, open, close }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAgentDrawer(): AgentDrawerCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAgentDrawer outside AgentDrawerProvider")
  return v
}
```

- [ ] **Step 6.2: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/contexts/AgentDrawerContext.test.tsx
```

Expected: PASS.

- [ ] **Step 6.3: Implement AgentDrawer (shell only)**

`app/src/components/agent/AgentDrawer.test.tsx`:

```tsx
import { describe, expect, test } from "vitest"
import { render, screen } from "@testing-library/react"
import { AgentDrawer } from "./AgentDrawer"
import { AgentDrawerProvider, useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { act } from "react"

function Harness() {
  const { open } = useAgentDrawer()
  return <button onClick={() => open("todoist:task:1")}>open</button>
}

describe("AgentDrawer", () => {
  test("renders nothing when closed", () => {
    render(
      <AgentDrawerProvider>
        <AgentDrawer />
      </AgentDrawerProvider>,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  test("renders sheet when open", () => {
    render(
      <AgentDrawerProvider>
        <Harness />
        <AgentDrawer />
      </AgentDrawerProvider>,
    )
    act(() => {
      screen.getByText("open").click()
    })
    // shadcn Sheet uses role=dialog
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
```

`app/src/components/agent/AgentDrawer.tsx`:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"

export function AgentDrawer() {
  const { isOpen, activeEntityRef, close } = useAgentDrawer()
  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="sm:max-w-[640px] p-0 flex flex-col h-full">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle>
            <span className="font-mono text-xs text-muted-foreground">{activeEntityRef ?? ""}</span>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">Transcript lands in Task 7.</p>
        </div>
        <div className="border-t p-3">
          <p className="text-sm text-muted-foreground">Composer lands in Task 11.</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 6.4: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/AgentDrawer.test.tsx
```

Expected: PASS.

- [ ] **Step 6.5: Wire AgentDrawerProvider into App.tsx**

Modify `app/src/App.tsx`. Add the provider above `<DialogProvider>` (so existing dialogs can also dispatch into it later if needed) and render `<AgentDrawer />` at the same depth as the existing `<DialogManager />`:

```tsx
// Add imports near the top:
import { AgentDrawer } from "@/components/agent/AgentDrawer"
import { AgentDrawerProvider } from "@/contexts/AgentDrawerContext"

// Inside the existing tree, find the OptimisticUpdatesProvider line and wrap DialogProvider:
//
//   <OptimisticUpdatesProvider>
//     <AgentDrawerProvider>           ← add
//       <DialogProvider>
//         <SidebarProvider defaultOpen>
//           <HeaderSlotProvider>
//             <Layout />
//           </HeaderSlotProvider>
//           <DialogManager />
//           <AgentDrawer />            ← add (sibling of DialogManager)
//           <Toaster />
//         </SidebarProvider>
//       </DialogProvider>
//     </AgentDrawerProvider>           ← add
//   </OptimisticUpdatesProvider>
```

- [ ] **Step 6.6: Implement the keybinding hook**

`app/src/hooks/useAgentKeybindings.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useAgentKeybindings } from "./useAgentKeybindings"

describe("useAgentKeybindings", () => {
  test("g then a within 500ms fires openForActiveTask", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: true, openForActiveTask: opener }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    expect(opener).toHaveBeenCalledOnce()
  })

  test("g alone does nothing", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: true, openForActiveTask: opener }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }))
    expect(opener).not.toHaveBeenCalled()
  })

  test("when typing in an input, g a does NOT fire", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: true, openForActiveTask: opener }))
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
    document.body.removeChild(input)
    expect(opener).not.toHaveBeenCalled()
  })

  test("enabled=false → no binding", () => {
    const opener = vi.fn()
    renderHook(() => useAgentKeybindings({ enabled: false, openForActiveTask: opener }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    expect(opener).not.toHaveBeenCalled()
  })
})
```

`app/src/hooks/useAgentKeybindings.ts`:

```ts
import { useEffect, useRef } from "react"

type Opts = {
  enabled: boolean
  openForActiveTask: () => void
}

const CHORD_TIMEOUT_MS = 500

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if (el.isContentEditable) return true
  return false
}

export function useAgentKeybindings({ enabled, openForActiveTask }: Opts) {
  const lastGAt = useRef<number>(0)
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const now = Date.now()
      if (e.key === "g") {
        lastGAt.current = now
        return
      }
      if (e.key === "a" && now - lastGAt.current <= CHORD_TIMEOUT_MS) {
        lastGAt.current = 0
        openForActiveTask()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled, openForActiveTask])
}
```

- [ ] **Step 6.7: Run hook test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/hooks/useAgentKeybindings.test.tsx
```

Expected: PASS.

- [ ] **Step 6.8: Mount the keybinding hook**

In a small wrapper component inside `App.tsx` (or directly in `Layout.tsx` if cleaner), mount the hook with access to the active task. Use the existing `useTaskSelection` hook to read which task is focused.

Add to `app/src/App.tsx` (or create a tiny `AgentKeybindings.tsx` component inside `components/agent/`):

```tsx
import { useAgentKeybindings } from "@/hooks/useAgentKeybindings"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"
// useTaskSelection's exact API — check existing usage in TaskListView/TaskListItem;
// the hook returns the currently focused task object (or null) per useTaskSelection.ts.

function AgentKeybindingsHost() {
  const { open } = useAgentDrawer()
  // Replace with the actual call surface from existing useTaskSelection — adapt.
  const activeTaskId: string | null = /* derive via existing hook or context */ null
  useAgentKeybindings({
    enabled: true,
    openForActiveTask: () => {
      if (activeTaskId) open(`todoist:task:${activeTaskId}`)
    },
  })
  return null
}
```

Render `<AgentKeybindingsHost />` inside `<AgentDrawerProvider>`.

NOTE: the exact wiring to "which task is currently focused" depends on `useTaskSelection`'s API which I haven't fully audited. The engineer should:
1. Open `app/src/hooks/useTaskSelection.ts` and read its return shape.
2. Either consume it directly (if it exposes a context) or accept the focused task id as a prop drilled from the layout.

- [ ] **Step 6.9: Add the "Open Agent" button to TaskListItem**

Open `app/src/components/list-items/TaskListItem.tsx`. Find the existing actions row (where edit/dropdown/quick actions live). Add a small icon button:

```tsx
import { Bot } from "lucide-react"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// In the row's actions:
const { open } = useAgentDrawer()

<Tooltip>
  <TooltipTrigger asChild>
    <button
      type="button"
      className="p-1 rounded hover:bg-accent text-muted-foreground"
      onClick={(e) => {
        e.stopPropagation()
        open(`todoist:task:${task.todoist_id}`)
      }}
      aria-label="Open Agent"
    >
      <Bot className="h-4 w-4" />
    </button>
  </TooltipTrigger>
  <TooltipContent>Open Agent (g a)</TooltipContent>
</Tooltip>
```

Place it next to existing per-row actions. If the row uses a dropdown menu for actions, prefer adding it to the dropdown's items rather than the row's primary action chrome.

- [ ] **Step 6.10: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

Expected: all green.

- [ ] **Step 6.11: Smoke test**

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Verify:
- Open a task list, click the new robot icon — the drawer slides in with the entity_ref shown in the header.
- Press `Esc` — drawer closes.
- Focus a task (click on it), press `g` then `a` quickly — drawer opens.
- URL shows `?agent=todoist:task:<id>` while open; gone when closed.
- Browser back closes the drawer.

Stop dev server.

- [ ] **Step 6.12: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/contexts/AgentDrawerContext.tsx app/src/contexts/AgentDrawerContext.test.tsx \
        app/src/components/agent/AgentDrawer.tsx app/src/components/agent/AgentDrawer.test.tsx \
        app/src/hooks/useAgentKeybindings.ts app/src/hooks/useAgentKeybindings.test.tsx \
        app/src/App.tsx app/src/components/list-items/TaskListItem.tsx
git commit --message "feat(agent): drawer shell + context + trigger button + g-a kbd

Side-sheet Agent drawer mounts via AgentDrawerProvider. URL ?agent=<ref>
is authoritative for open state. Robot icon on TaskListItem and the
'g a' chord both call open(entity_ref). Body is still a placeholder
pending Task 7."
```

---

## Task 7: Commit 4 (production build) — Transcript wired to assistant-ui + Convex

**Goal:** Real Convex thread renders end-to-end inside the drawer using `useExternalStoreRuntime`. Only text-message kinds wired so far — work-log, tool-call cards, proposal card, composer all still TODO.

**Files:**
- Create: `app/src/hooks/useAgentRuntime.ts`
- Create: `app/src/hooks/useAgentRuntime.test.tsx`
- Modify (replace stub): `app/src/components/agent/AgentTranscript.tsx`
- Modify: `app/src/components/agent/AgentDrawer.tsx` (mount `<AgentTranscript>` in body)

- [ ] **Step 7.1: Implement useAgentRuntime**

`app/src/hooks/useAgentRuntime.ts`:

```ts
import { useExternalStoreRuntime } from "@assistant-ui/react"
import { useQuery } from "convex/react"
import { useMemo } from "react"
import { api } from "@/convex/_generated/api"
import { convertMessage, type ThreadRow } from "@/lib/agent/convertMessage"

export function useAgentRuntime(entity_ref: string | null) {
  const rows = useQuery(
    api.agentic.queries.getThread.default,
    entity_ref ? { entity_ref } : "skip",
  ) as ThreadRow[] | undefined
  const run = useQuery(
    api.agentic.queries.getRun.default,
    entity_ref ? { entity_ref } : "skip",
  )

  const messages = useMemo(
    () => (rows ?? []).map(convertMessage),
    [rows],
  )

  const isRunning = run?.status === "discovering" || run?.status === "executing"

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (m) => m,
    onNew: async (msg) => {
      // Wired in Task 11 (composer).
      console.warn("[agent] onNew not yet wired", msg)
    },
    onCancel: async () => {
      // Wired in Task 11 (composer Stop).
      console.warn("[agent] onCancel not yet wired")
    },
  })

  return { runtime, rows, run, isRunning, isLoading: rows === undefined || run === undefined }
}
```

- [ ] **Step 7.2: Write a smoke test for the hook**

`app/src/hooks/useAgentRuntime.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { renderHook } from "@testing-library/react"

// Hook depends on convex/react + assistant-ui; use vitest mocks rather than spinning
// up convex-test for this unit. Integration coverage lives in agent-drawer.integration.test.tsx
// (Task 14).
vi.mock("convex/react", () => ({
  useQuery: vi.fn().mockReturnValue(undefined),
}))
vi.mock("@/convex/_generated/api", () => ({ api: { agentic: { queries: {
  getThread: { default: "stub" }, getRun: { default: "stub" },
} } } }))
vi.mock("@assistant-ui/react", () => ({
  useExternalStoreRuntime: vi.fn().mockReturnValue({ _kind: "runtime" }),
}))

const { useAgentRuntime } = await import("./useAgentRuntime")

describe("useAgentRuntime", () => {
  test("returns isLoading=true when queries undefined", () => {
    const { result } = renderHook(() => useAgentRuntime("todoist:task:1"))
    expect(result.current.isLoading).toBe(true)
  })

  test("returns a runtime object", () => {
    const { result } = renderHook(() => useAgentRuntime("todoist:task:1"))
    expect(result.current.runtime).toEqual({ _kind: "runtime" })
  })
})
```

- [ ] **Step 7.3: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/hooks/useAgentRuntime.test.tsx
```

Expected: PASS.

- [ ] **Step 7.4: Implement AgentTranscript (text-only renderers)**

`app/src/components/agent/AgentTranscript.tsx`:

```tsx
import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"

function MarkdownProse({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export function AgentTranscript({ entity_ref }: { entity_ref: string }) {
  const { runtime, isLoading } = useAgentRuntime(entity_ref)
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread.Root className="flex flex-col gap-3">
        <Thread.Viewport className="flex-1">
          <Thread.Messages
            components={{
              UserMessage: ({ children }) => (
                <div className="ml-auto max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-sm">
                  {children}
                </div>
              ),
              AssistantMessage: ({ children }) => (
                <div className="max-w-full text-sm">{children}</div>
              ),
              // Custom parts arrive in Tasks 8-10. Text part is built-in.
            } as never}
          />
        </Thread.Viewport>
      </Thread.Root>
    </AssistantRuntimeProvider>
  )
}

export { MarkdownProse }
```

- [ ] **Step 7.5: Mount AgentTranscript in the drawer**

Modify `app/src/components/agent/AgentDrawer.tsx` to replace the placeholder body:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { AgentTranscript } from "./AgentTranscript"

export function AgentDrawer() {
  const { isOpen, activeEntityRef, close } = useAgentDrawer()
  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="sm:max-w-[640px] p-0 flex flex-col h-full">
        <SheetHeader className="px-4 py-3 border-b">
          <SheetTitle>
            <span className="font-mono text-xs text-muted-foreground">{activeEntityRef ?? ""}</span>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {activeEntityRef ? <AgentTranscript entity_ref={activeEntityRef} /> : null}
        </div>
        <div className="border-t p-3">
          <p className="text-sm text-muted-foreground">Composer lands in Task 11.</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 7.6: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

- [ ] **Step 7.7: Smoke test against seeded thread**

```bash
cd ~/Documents/GitHub/master-db
bunx convex run agentic/dev/seed:seedSpikeThread
bun --cwd app run dev
```

In the browser, manually navigate the URL to include `?agent=todoist:task:spike-001` (or invoke a temporary task list item that opens that ref). The drawer should show text bubbles for user_message + assistant_message. proposal/tool-call/reasoning rows render as empty / unhandled placeholders (expected — those land in Tasks 8–10).

Stop dev server.

- [ ] **Step 7.8: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/hooks/useAgentRuntime.ts app/src/hooks/useAgentRuntime.test.tsx \
        app/src/components/agent/AgentTranscript.tsx app/src/components/agent/AgentDrawer.tsx
git commit --message "feat(agent): wire transcript to assistant-ui + Convex

useAgentRuntime wraps useExternalStoreRuntime with Convex getThread +
getRun queries. AgentTranscript renders text bubbles for user_message
and assistant_message. Proposal/work-log/tool-call rendering arrives in
the next commits."
```

---

## Task 8: Commit 5 (production build) — Work-log group rendering

**Goal:** Reasoning + tool-call rows coalesce into a single collapsible "Work log · N items · Ns" section per turn.

**Files:**
- Modify (replace stub): `app/src/components/agent/WorkLogGroup.tsx`
- Create: `app/src/components/agent/WorkLogGroup.test.tsx`
- Modify: `app/src/components/agent/AgentTranscript.tsx` (render groups instead of always raw `<Thread.Messages>`)

- [ ] **Step 8.1: Write component test**

`app/src/components/agent/WorkLogGroup.test.tsx`:

```tsx
import { describe, expect, test } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WorkLogGroup } from "./WorkLogGroup"
import type { ThreadRow } from "@/lib/agent/convertMessage"

function items(n: number): ThreadRow[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `i${i}`, row_type: i % 2 === 0 ? "message" : "activity",
    sequence: i + 1, run_id: "r1",
    kind: i % 2 === 0 ? "reasoning" : "tool_call",
    body_markdown: `step ${i}`,
    name: i % 2 === 1 ? "Read" : undefined,
    input_json: {}, output_json: {}, status: "ok",
    proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null,
    resolved_at: null,
  }) as ThreadRow)
}

describe("WorkLogGroup", () => {
  test("renders header with count", () => {
    render(<WorkLogGroup items={items(5)} firstSequence={1} lastSequence={5} run_id="r1" />)
    expect(screen.getByText(/Work log · 5 items/)).toBeInTheDocument()
  })

  test("renders only the last 3 items by default", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    // Items 4,5,6 visible (indices 4,5,6 by step text)
    expect(screen.queryByText("step 0")).toBeNull()
    expect(screen.getByText("step 6")).toBeInTheDocument()
  })

  test("Show all expands to reveal hidden items", () => {
    render(<WorkLogGroup items={items(7)} firstSequence={1} lastSequence={7} run_id="r1" />)
    expect(screen.queryByText("step 0")).toBeNull()
    fireEvent.click(screen.getByText(/Show all 7/))
    expect(screen.getByText("step 0")).toBeInTheDocument()
  })

  test("groups of <=3 do not show expand control", () => {
    render(<WorkLogGroup items={items(3)} firstSequence={1} lastSequence={3} run_id="r1" />)
    expect(screen.queryByText(/Show all/)).toBeNull()
  })
})
```

- [ ] **Step 8.2: Run test, expect failure**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/WorkLogGroup.test.tsx
```

Expected: FAIL — stub returns null.

- [ ] **Step 8.3: Implement WorkLogGroup**

`app/src/components/agent/WorkLogGroup.tsx`:

```tsx
// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.tsx
//                    (Work-log section rendering + expand control)

import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"
import type { ThreadRow } from "@/lib/agent/convertMessage"

const MAX_VISIBLE = 3

function rowLabel(r: ThreadRow): string {
  if (r.row_type === "activity") return `${r.name ?? "tool"} · ${r.status ?? ""}`
  return r.body_markdown ?? r.kind
}

export function WorkLogGroup({
  items,
  firstSequence,
  lastSequence,
  run_id,
}: {
  items: ThreadRow[]
  firstSequence: number
  lastSequence: number
  run_id: string
}) {
  void firstSequence; void lastSequence; void run_id // reserved for elapsed-time / cross-link
  const [expanded, setExpanded] = useState(false)
  const visible = expanded || items.length <= MAX_VISIBLE
    ? items
    : items.slice(items.length - MAX_VISIBLE)
  const hiddenCount = items.length - visible.length

  return (
    <div className="my-2 rounded-md border bg-card/50">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b">
        <span>Work log · {items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="px-3 py-1 text-xs">
        {hiddenCount > 0 && !expanded && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 py-1"
            >
              <ChevronRight className="h-3 w-3" />
              Show all {items.length} →
            </button>
          </li>
        )}
        {visible.map((r) => (
          <li key={r._id} className="py-1 text-foreground/80 flex items-center gap-1">
            <ChevronDown className="h-3 w-3 opacity-30" />
            <span className="truncate">{rowLabel(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 8.4: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/WorkLogGroup.test.tsx
```

Expected: PASS.

- [ ] **Step 8.5: Wire WorkLogGroup into AgentTranscript**

Modify `app/src/components/agent/AgentTranscript.tsx`. Instead of feeding `<Thread.Messages>` the full `messages` array directly, walk the raw `rows` (from `useAgentRuntime`) through `groupWorkLog`, then render either a bubble (via inline JSX) or a `<WorkLogGroup>` per item.

This means we step away from `Thread.Messages`'s built-in iteration and render manually. assistant-ui still owns the runtime + Composer; we just hand-render the list.

Replace the body of `AgentTranscript`:

```tsx
import { AssistantRuntimeProvider, Thread } from "@assistant-ui/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { groupWorkLog } from "@/lib/agent/workLogGrouping"
import { WorkLogGroup } from "./WorkLogGroup"

function Prose({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

export function AgentTranscript({ entity_ref }: { entity_ref: string }) {
  const { runtime, rows, isLoading } = useAgentRuntime(entity_ref)
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  const grouped = groupWorkLog(rows ?? [])
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread.Root className="flex flex-col gap-3">
        <Thread.Viewport>
          {grouped.map((item, i) => {
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
            const r = item.row
            if (r.kind === "user_message") {
              return (
                <div
                  key={r._id}
                  className="ml-auto max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-sm"
                >
                  {r.body_markdown}
                </div>
              )
            }
            if (r.kind === "assistant_message") {
              return (
                <div key={r._id} className="text-sm">
                  <Prose text={r.body_markdown ?? ""} />
                </div>
              )
            }
            if (r.kind === "proposal") {
              return (
                <div key={r._id} className="text-sm text-muted-foreground italic">
                  [proposal renders in Task 10] · checkpoint_id={r.checkpoint_id}
                </div>
              )
            }
            if (r.kind === "execution_result") {
              return (
                <div key={r._id} className="text-sm rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
                  ✓ {r.body_markdown}
                </div>
              )
            }
            if (r.kind === "error") {
              return (
                <div key={r._id} className="text-sm text-muted-foreground italic">
                  [error renders in Task 13]
                </div>
              )
            }
            void i
            return null
          })}
        </Thread.Viewport>
      </Thread.Root>
    </AssistantRuntimeProvider>
  )
}
```

- [ ] **Step 8.6: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

Expected: all green.

- [ ] **Step 8.7: Smoke test**

Re-seed and dev-server. The drawer should now show a "Work log · N items" section grouping the reasoning + tool_call rows from the seed.

- [ ] **Step 8.8: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/components/agent/WorkLogGroup.tsx app/src/components/agent/WorkLogGroup.test.tsx \
        app/src/components/agent/AgentTranscript.tsx
git commit --message "feat(agent): work-log grouping in transcript

Consecutive reasoning + tool_call rows (within one run_id) coalesce
into a collapsible 'Work log · N items' section. t3code-derived
pattern. Last 3 items visible by default; 'Show all N' expands."
```

---

## Task 9: Commit 6 (production build) — Generic ToolCallCard

**Goal:** Inside the work-log group, each tool-call row renders as a per-row collapsible card with name + input + output. Generic; per-tool variants are a reserved seam.

**Files:**
- Modify (replace stub): `app/src/components/agent/ToolCallCard.tsx`
- Create: `app/src/components/agent/ToolCallCard.test.tsx`
- Modify: `app/src/components/agent/WorkLogGroup.tsx` (use ToolCallCard for tool_call rows)

- [ ] **Step 9.1: Write test**

`app/src/components/agent/ToolCallCard.test.tsx`:

```tsx
import { describe, expect, test } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ToolCallCard } from "./ToolCallCard"

describe("ToolCallCard", () => {
  test("renders tool name + status", () => {
    render(<ToolCallCard name="search_obsidian" status="ok" input={{ q: "x" }} output={{ hits: 2 }} />)
    expect(screen.getByText("search_obsidian")).toBeInTheDocument()
    expect(screen.getByText("ok")).toBeInTheDocument()
  })

  test("collapsed by default; click expands", () => {
    render(<ToolCallCard name="Read" status="ok" input={{ path: "/x" }} output={{ content: "hi" }} />)
    expect(screen.queryByText(/path/)).toBeNull()
    fireEvent.click(screen.getByText("Read"))
    expect(screen.getByText(/path/)).toBeInTheDocument()
  })

  test("pending state shows distinct affordance", () => {
    render(<ToolCallCard name="Bash" status="pending" input={{}} output={null} />)
    expect(screen.getByText("pending")).toBeInTheDocument()
  })
})
```

- [ ] **Step 9.2: Run test, expect fail**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ToolCallCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 9.3: Implement**

`app/src/components/agent/ToolCallCard.tsx`:

```tsx
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { toolRegistry } from "@/lib/agent/tool-registry"

type Props = {
  name: string
  status: string
  input: unknown
  output: unknown
}

export function ToolCallCard({ name, status, input, output }: Props) {
  const [open, setOpen] = useState(false)

  // Reserved seam: per-tool variants register in toolRegistry.
  const Custom = toolRegistry[name as keyof typeof toolRegistry] as
    | ((p: Props) => JSX.Element)
    | undefined
  if (Custom) return <Custom name={name} status={status} input={input} output={output} />

  const statusClass =
    status === "ok" ? "text-emerald-500" :
    status === "error" ? "text-rose-500" :
    "text-amber-500"

  return (
    <div className="rounded-md border bg-card/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-xs hover:bg-accent/50"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-medium">{name}</span>
        <span className={statusClass}>{status}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 text-[11px] font-mono">
          <div className="text-muted-foreground mt-1">input</div>
          <pre className="overflow-auto bg-muted/30 p-1 rounded">{JSON.stringify(input, null, 2)}</pre>
          <div className="text-muted-foreground mt-1">output</div>
          <pre className="overflow-auto bg-muted/30 p-1 rounded">{JSON.stringify(output, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 9.4: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ToolCallCard.test.tsx
```

Expected: PASS.

- [ ] **Step 9.5: Render ToolCallCard inside WorkLogGroup**

Modify the `visible.map((r) => ...)` block in `WorkLogGroup.tsx` to render `<ToolCallCard>` for `row_type === "activity" && kind === "tool_call"` and keep the existing chevron-row for reasoning kinds.

Replace the visible-items rendering:

```tsx
{visible.map((r) => {
  if (r.row_type === "activity" && r.kind === "tool_call") {
    return (
      <li key={r._id} className="py-1">
        <ToolCallCard
          name={r.name ?? "unknown"}
          status={r.status ?? "pending"}
          input={r.input_json}
          output={r.output_json}
        />
      </li>
    )
  }
  return (
    <li key={r._id} className="py-1 text-foreground/80 flex items-center gap-1">
      <ChevronDown className="h-3 w-3 opacity-30" />
      <span className="truncate">{r.body_markdown ?? r.kind}</span>
    </li>
  )
})}
```

Add at the top: `import { ToolCallCard } from "./ToolCallCard"`.

- [ ] **Step 9.6: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

- [ ] **Step 9.7: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/components/agent/ToolCallCard.tsx app/src/components/agent/ToolCallCard.test.tsx \
        app/src/components/agent/WorkLogGroup.tsx
git commit --message "feat(agent): generic ToolCallCard inside work-log group

Collapsible per-tool-call card with name + status pill + input/output
JSON. Reserved seam: per-tool variants register in lib/agent/tool-registry.ts."
```

---

## Task 10: Commit 7 (production build) — Proposal card with per-option Execute / Modify

**Goal:** When a `proposal` row appears, render it as the per-option cards (Layout A). Execute and Modify wiring depends on the engine client (which lands here too).

**Files:**
- Create: `app/src/lib/agent/engineClient.ts`
- Create: `app/src/lib/agent/engineClient.test.ts`
- Create: `app/src/hooks/useAgentPost.ts`
- Create: `app/src/hooks/useAgentPost.test.tsx`
- Modify (replace stub): `app/src/components/agent/ProposalOptionRow.tsx`
- Create: `app/src/components/agent/ProposalOptionRow.test.tsx`
- Modify (replace stub): `app/src/components/agent/ProposalCard.tsx`
- Create: `app/src/components/agent/ProposalCard.test.tsx`
- Modify (replace stub): `app/src/components/agent/RewindButton.tsx`
- Modify: `app/src/components/agent/AgentTranscript.tsx` (render `<ProposalCard>` for proposal rows)

### Task 10a: engineClient

- [ ] **Step 10a.1: Write test**

`app/src/lib/agent/engineClient.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from "vitest"
import { postRun, postInterrupt } from "./engineClient"

const ENGINE = "http://localhost:8787"
const TOKEN = "test-tok"

beforeEach(() => {
  vi.stubEnv("VITE_AGENTIC_ENGINE_URL", ENGINE)
  vi.stubEnv("VITE_AGENTIC_ENGINE_TOKEN", TOKEN)
})

describe("postRun", () => {
  test("POSTs JSON body with bearer + idempotency-key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run_id: "r1", status: "discovering", accepted: true }) })
    vi.stubGlobal("fetch", fetchMock)
    const res = await postRun({ entity_ref: "todoist:task:1", message: null, idempotency_key: "k1" })
    expect(fetchMock).toHaveBeenCalledWith(`${ENGINE}/run`, expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Authorization": `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "k1",
      }),
    }))
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body).toEqual({ entity_ref: "todoist:task:1", message: null })
    expect(res).toEqual({ run_id: "r1", status: "discovering", accepted: true })
  })

  test("sends multitask_strategy when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    await postRun({ entity_ref: "x", message: "EXECUTE: a", idempotency_key: "k", multitask_strategy: "interrupt" })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
    expect(body.multitask_strategy).toBe("interrupt")
  })

  test("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }))
    await expect(postRun({ entity_ref: "x", message: null, idempotency_key: "k" })).rejects.toThrow(/409/)
  })
})

describe("postInterrupt", () => {
  test("POSTs to /run/:ref/interrupt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "idle" }) })
    vi.stubGlobal("fetch", fetchMock)
    await postInterrupt("todoist:task:1")
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENGINE}/run/${encodeURIComponent("todoist:task:1")}/interrupt`,
      expect.objectContaining({ method: "POST" }),
    )
  })
})
```

- [ ] **Step 10a.2: Run, expect fail**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/engineClient.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 10a.3: Implement**

`app/src/lib/agent/engineClient.ts`:

```ts
export type PostRunInput = {
  entity_ref: string
  message: string | null
  idempotency_key: string
  multitask_strategy?: "enqueue" | "interrupt" | "reject"
  webhook?: string
  webhook_token?: string
}

export type PostRunResponse = {
  entity_ref: string
  run_id: string
  status: string
  accepted: boolean
}

function getEngineConfig() {
  const url = import.meta.env.VITE_AGENTIC_ENGINE_URL as string | undefined
  const token = import.meta.env.VITE_AGENTIC_ENGINE_TOKEN as string | undefined
  if (!url || !token) throw new Error("agentic engine config missing — set VITE_AGENTIC_ENGINE_URL and VITE_AGENTIC_ENGINE_TOKEN")
  return { url, token }
}

export async function postRun(input: PostRunInput): Promise<PostRunResponse> {
  const { url, token } = getEngineConfig()
  const { idempotency_key, ...body } = input
  const res = await fetch(`${url}/run`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotency_key,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`postRun failed: ${res.status}`)
  return res.json()
}

export async function postInterrupt(entity_ref: string): Promise<{ status: string }> {
  const { url, token } = getEngineConfig()
  const res = await fetch(`${url}/run/${encodeURIComponent(entity_ref)}/interrupt`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`postInterrupt failed: ${res.status}`)
  return res.json()
}
```

- [ ] **Step 10a.4: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/lib/agent/engineClient.test.ts
```

Expected: PASS.

### Task 10b: useAgentPost hook

- [ ] **Step 10b.1: Write test**

`app/src/hooks/useAgentPost.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"

vi.mock("@/lib/agent/engineClient", () => ({
  postRun: vi.fn().mockResolvedValue({ run_id: "r1", status: "discovering", accepted: true }),
  postInterrupt: vi.fn().mockResolvedValue({ status: "idle" }),
}))
vi.mock("ulid", () => ({ ulid: () => "01HULID" }))

const { useAgentPost } = await import("./useAgentPost")
const { postRun, postInterrupt } = await import("@/lib/agent/engineClient")

describe("useAgentPost", () => {
  test("execute() sends EXECUTE: id with interrupt strategy", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.execute("opt-b")
    })
    expect(postRun).toHaveBeenCalledWith(expect.objectContaining({
      entity_ref: "todoist:task:1",
      message: "EXECUTE: opt-b",
      multitask_strategy: "interrupt",
    }))
  })

  test("modify() sends MODIFY: id: text", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.modify("opt-b", "use a comma instead")
    })
    expect(postRun).toHaveBeenCalledWith(expect.objectContaining({
      message: "MODIFY: opt-b: use a comma instead",
    }))
  })

  test("interrupt() calls postInterrupt", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.interrupt()
    })
    expect(postInterrupt).toHaveBeenCalledWith("todoist:task:1")
  })

  test("each call gets a fresh idempotency_key (from ulid())", async () => {
    const { result } = renderHook(() => useAgentPost("todoist:task:1"))
    await act(async () => {
      await result.current.send("hello")
    })
    expect(postRun).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: "01HULID",
    }))
  })
})
```

- [ ] **Step 10b.2: Install ulid dep**

```bash
cd ~/Documents/GitHub/master-db
bun add --cwd app ulid
```

- [ ] **Step 10b.3: Implement**

`app/src/hooks/useAgentPost.ts`:

```ts
import { useCallback } from "react"
import { ulid } from "ulid"
import { postInterrupt, postRun } from "@/lib/agent/engineClient"

export function useAgentPost(entity_ref: string) {
  const send = useCallback(
    async (message: string, strategy: "enqueue" | "interrupt" = "enqueue") => {
      return postRun({
        entity_ref,
        message,
        idempotency_key: ulid(),
        multitask_strategy: strategy,
      })
    },
    [entity_ref],
  )

  const execute = useCallback(
    (option_id: string) => send(`EXECUTE: ${option_id}`, "interrupt"),
    [send],
  )

  const modify = useCallback(
    (option_id: string, text: string) =>
      send(`MODIFY: ${option_id}: ${text}`, "enqueue"),
    [send],
  )

  const interrupt = useCallback(async () => postInterrupt(entity_ref), [entity_ref])

  return { send, execute, modify, interrupt }
}
```

- [ ] **Step 10b.4: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/hooks/useAgentPost.test.tsx
```

Expected: PASS.

### Task 10c: ProposalOptionRow

- [ ] **Step 10c.1: Write test**

`app/src/components/agent/ProposalOptionRow.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ProposalOptionRow } from "./ProposalOptionRow"
import type { ProposalOption } from "@/lib/agent/proposalToParts"

const opt: ProposalOption = {
  id: "b",
  label: "Propose pushing to June 21",
  description: "Reply asking Sarah to move.",
  confidence: 0.85,
  reversibility: "trivial",
  side_effects: ["sends email"],
}

describe("ProposalOptionRow", () => {
  test("renders label + confidence + reversibility + side effects", () => {
    render(<ProposalOptionRow option={opt} recommended={false} onExecute={() => {}} onModify={() => {}} />)
    expect(screen.getByText(opt.label)).toBeInTheDocument()
    expect(screen.getByText(/85%/)).toBeInTheDocument()
    expect(screen.getByText(/trivial/)).toBeInTheDocument()
    expect(screen.getByText(/sends email/)).toBeInTheDocument()
  })

  test("recommended badge appears when recommended=true", () => {
    render(<ProposalOptionRow option={opt} recommended onExecute={() => {}} onModify={() => {}} />)
    expect(screen.getByText(/Recommended/i)).toBeInTheDocument()
  })

  test("Execute click fires onExecute with option id", () => {
    const onExecute = vi.fn()
    render(<ProposalOptionRow option={opt} recommended onExecute={onExecute} onModify={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /^Execute$/ }))
    expect(onExecute).toHaveBeenCalledWith("b")
  })

  test("Modify click fires onModify with option id", () => {
    const onModify = vi.fn()
    render(<ProposalOptionRow option={opt} recommended={false} onExecute={() => {}} onModify={onModify} />)
    fireEvent.click(screen.getByRole("button", { name: /Modify/i }))
    expect(onModify).toHaveBeenCalledWith("b")
  })
})
```

- [ ] **Step 10c.2: Run, expect fail**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ProposalOptionRow.test.tsx
```

Expected: FAIL.

- [ ] **Step 10c.3: Implement**

`app/src/components/agent/ProposalOptionRow.tsx`:

```tsx
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ProposalOption } from "@/lib/agent/proposalToParts"

const REV_CLASS: Record<string, string> = {
  trivial: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  moderate: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  destructive: "bg-rose-500/10 text-rose-600 border-rose-500/20",
}

export function ProposalOptionRow({
  option,
  recommended,
  onExecute,
  onModify,
}: {
  option: ProposalOption
  recommended: boolean
  onExecute: (id: string) => void
  onModify: (id: string) => void
}) {
  return (
    <div className={`rounded-md border p-3 ${recommended ? "border-emerald-500 ring-1 ring-emerald-500" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-medium text-sm">{option.label}</div>
        {recommended && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">★ Recommended</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-2">{option.description}</p>
      {option.rationale && (
        <p className="text-xs text-muted-foreground/70 mb-2 italic">{option.rationale}</p>
      )}
      <div className="flex flex-wrap gap-1 mb-3">
        <Badge variant="secondary" className="text-[10px]">{Math.round(option.confidence * 100)}% confident</Badge>
        <Badge variant="outline" className={`text-[10px] ${REV_CLASS[option.reversibility] ?? ""}`}>
          {option.reversibility}
        </Badge>
        {option.side_effects?.map((s) => (
          <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant={recommended ? "default" : "secondary"}
          onClick={() => onExecute(option.id)}
        >
          Execute
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onModify(option.id)}>
          Modify…
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 10c.4: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ProposalOptionRow.test.tsx
```

### Task 10d: ProposalCard + RewindButton

- [ ] **Step 10d.1: Write test**

`app/src/components/agent/ProposalCard.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProposalCard } from "./ProposalCard"
import type { Proposal } from "@/lib/agent/proposalToParts"

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: vi.fn().mockReturnValue({
    execute: vi.fn(), modify: vi.fn(), send: vi.fn(), interrupt: vi.fn(),
  }),
}))

const proposal: Proposal = {
  kind: "proposal",
  summary: "summary text",
  findings: ["a", "b"],
  options: [
    { id: "a", label: "A", description: "d", confidence: 0.6, reversibility: "moderate" },
    { id: "b", label: "B", description: "d2", confidence: 0.85, reversibility: "trivial" },
  ],
  recommended_option_id: "b",
  free_text_allowed: true,
}

describe("ProposalCard", () => {
  test("renders summary + findings + all options", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getByText(/summary text/)).toBeInTheDocument()
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.getByText("B")).toBeInTheDocument()
  })

  test("recommended option has badge, other does not", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    // The badge appears once total — on option B
    expect(screen.getAllByText(/Recommended/i)).toHaveLength(1)
  })

  test("findings list rendered as list items", () => {
    render(<ProposalCard entity_ref="todoist:task:1" proposal={proposal} checkpoint_id="ck1" />)
    expect(screen.getByText("a")).toBeInTheDocument()
    expect(screen.getByText("b")).toBeInTheDocument()
  })
})
```

- [ ] **Step 10d.2: Run, expect fail**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ProposalCard.test.tsx
```

- [ ] **Step 10d.3: Implement RewindButton**

`app/src/components/agent/RewindButton.tsx`:

```tsx
import { toast } from "sonner"
import { Undo2 } from "lucide-react"

export function RewindButton({ checkpoint_id }: { checkpoint_id: string }) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`Rewind not yet available — coming in Phase 2. (checkpoint ${checkpoint_id})`)}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <Undo2 className="h-3 w-3" />
      Rewind here
    </button>
  )
}
```

- [ ] **Step 10d.4: Implement ProposalCard**

`app/src/components/agent/ProposalCard.tsx`:

```tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useAgentPost } from "@/hooks/useAgentPost"
import { ProposalOptionRow } from "./ProposalOptionRow"
import { RewindButton } from "./RewindButton"
import { useAgentComposerHandle } from "@/contexts/AgentComposerContext"
import type { Proposal } from "@/lib/agent/proposalToParts"

type Props = {
  entity_ref: string
  proposal: Proposal
  checkpoint_id: string | null
}

export function ProposalCard({ entity_ref, proposal, checkpoint_id }: Props) {
  const { execute } = useAgentPost(entity_ref)
  const composer = useAgentComposerHandle()

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="prose prose-sm dark:prose-invert max-w-none mb-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{proposal.summary}</ReactMarkdown>
      </div>
      {proposal.findings && proposal.findings.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Receipts
          </div>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            {proposal.findings.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>
      )}
      <div className="space-y-2">
        {proposal.options.map((o) => (
          <ProposalOptionRow
            key={o.id}
            option={o}
            recommended={o.id === proposal.recommended_option_id}
            onExecute={(id) => execute(id)}
            onModify={(id) => composer?.startModify(id, o.label)}
          />
        ))}
      </div>
      {checkpoint_id && (
        <div className="mt-3 flex justify-end">
          <RewindButton checkpoint_id={checkpoint_id} />
        </div>
      )}
    </div>
  )
}
```

NOTE: this references `useAgentComposerHandle` from a `AgentComposerContext` that doesn't exist yet. Create the minimal context now so the import resolves. The handle implementation is fleshed out in Task 11.

`app/src/contexts/AgentComposerContext.tsx`:

```tsx
import { createContext, useContext, useRef, type ReactNode } from "react"

export type ComposerHandle = {
  startModify: (option_id: string, option_label: string) => void
  focus: () => void
}

const Ctx = createContext<ComposerHandle | null>(null)

export function AgentComposerProvider({ children }: { children: ReactNode }) {
  // Mutable ref reassigned by AgentComposer on mount (see Task 11).
  const ref = useRef<ComposerHandle | null>(null)
  return <Ctx.Provider value={{
    startModify: (id, label) => ref.current?.startModify(id, label),
    focus: () => ref.current?.focus(),
  }}>{children}</Ctx.Provider>
}

export function useAgentComposerHandle(): ComposerHandle | null {
  return useContext(Ctx)
}

// Internal: AgentComposer assigns its impl here on mount.
export function useRegisterComposerImpl(): React.MutableRefObject<ComposerHandle | null> {
  // This is a minimal placeholder; Task 11's AgentComposer wires the real one.
  return useRef<ComposerHandle | null>(null)
}
```

Mount `<AgentComposerProvider>` inside `<AgentDrawer>` body, wrapping the body content. Update `AgentDrawer.tsx`:

```tsx
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"

// Wrap the body + footer:
<AgentComposerProvider>
  <div className="flex-1 overflow-y-auto p-4">
    {activeEntityRef ? <AgentTranscript entity_ref={activeEntityRef} /> : null}
  </div>
  <div className="border-t p-3">
    <p className="text-sm text-muted-foreground">Composer lands in Task 11.</p>
  </div>
</AgentComposerProvider>
```

- [ ] **Step 10d.5: Run ProposalCard test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ProposalCard.test.tsx
```

- [ ] **Step 10d.6: Wire ProposalCard into the transcript**

Replace the `if (r.kind === "proposal") { ... [proposal renders in Task 10] ... }` placeholder in `AgentTranscript.tsx`:

```tsx
import { ProposalCard } from "./ProposalCard"
import { isProposal } from "@/lib/agent/proposalToParts"

// inside the row switch:
if (r.kind === "proposal" && isProposal(r.proposal_json)) {
  return (
    <ProposalCard
      key={r._id}
      entity_ref={entity_ref}
      proposal={r.proposal_json}
      checkpoint_id={r.checkpoint_id ?? null}
    />
  )
}
```

- [ ] **Step 10d.7: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

- [ ] **Step 10d.8: Smoke test**

Re-seed, dev server. The seeded thread should now show the proposal as three option cards with option B recommended.

- [ ] **Step 10d.9: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/lib/agent/engineClient.ts app/src/lib/agent/engineClient.test.ts \
        app/src/hooks/useAgentPost.ts app/src/hooks/useAgentPost.test.tsx \
        app/src/components/agent/ProposalOptionRow.tsx app/src/components/agent/ProposalOptionRow.test.tsx \
        app/src/components/agent/ProposalCard.tsx app/src/components/agent/ProposalCard.test.tsx \
        app/src/components/agent/RewindButton.tsx \
        app/src/contexts/AgentComposerContext.tsx \
        app/src/components/agent/AgentDrawer.tsx app/src/components/agent/AgentTranscript.tsx \
        app/package.json app/bun.lock
git commit --message "feat(agent): proposal card with per-option Execute/Modify

ProposalCard (Layout A) — summary + findings + per-option cards with
confidence, reversibility, side-effects. Recommended option gets green
outline + badge. Execute hits POST /run with EXECUTE: id +
multitask_strategy=interrupt. Modify focuses the composer with a
prefix (handle wired in Task 11). RewindButton fires a sonner toast
(reserved seam). engineClient + useAgentPost wrap the engine HTTP API
with ulid idempotency keys."
```

---

## Task 11: Commit 8 (production build) — Composer with Send/Stop swap + MODIFY pre-fill

**Goal:** Always-visible composer at the bottom of the drawer. Plain free-text sends `POST /run` with the typed message. ⌘+Enter to send. While `isRunning`, the primary button becomes Stop (interrupt). Modify… buttons on proposal options focus the composer with `Modify option <label>: ` pre-filled.

**Files:**
- Modify (replace stub): `app/src/components/agent/AgentComposer.tsx`
- Create: `app/src/components/agent/AgentComposer.test.tsx`
- Modify: `app/src/contexts/AgentComposerContext.tsx` (finalize impl-registration)
- Modify: `app/src/components/agent/AgentDrawer.tsx` (mount `<AgentComposer>` in the footer)

- [ ] **Step 11.1: Finalize AgentComposerContext**

Rewrite `app/src/contexts/AgentComposerContext.tsx` to expose a registration ref properly:

```tsx
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"

export type ComposerHandle = {
  startModify: (option_id: string, option_label: string) => void
  focus: () => void
}

type Ctx = {
  getHandle: () => ComposerHandle | null
  register: (h: ComposerHandle | null) => void
}

const ComposerCtx = createContext<Ctx | null>(null)

export function AgentComposerProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ComposerHandle | null>(null)
  const value = useMemo<Ctx>(() => ({
    getHandle: () => ref.current,
    register: (h) => { ref.current = h },
  }), [])
  return <ComposerCtx.Provider value={value}>{children}</ComposerCtx.Provider>
}

export function useAgentComposerHandle(): ComposerHandle | null {
  const c = useContext(ComposerCtx)
  return c?.getHandle() ?? null
}

export function useRegisterComposer(): (h: ComposerHandle | null) => void {
  const c = useContext(ComposerCtx)
  if (!c) throw new Error("AgentComposer must be inside AgentComposerProvider")
  return c.register
}
```

- [ ] **Step 11.2: Write AgentComposer test**

`app/src/components/agent/AgentComposer.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AgentComposer } from "./AgentComposer"
import { AgentComposerProvider } from "@/contexts/AgentComposerContext"

const send = vi.fn().mockResolvedValue({})
const interrupt = vi.fn().mockResolvedValue({})

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: () => ({ send, interrupt, execute: vi.fn(), modify: vi.fn() }),
}))

function wrap(ui: React.ReactNode) {
  return render(<AgentComposerProvider>{ui}</AgentComposerProvider>)
}

describe("AgentComposer", () => {
  test("renders Send by default", () => {
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning={false} />)
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument()
  })

  test("Cmd+Enter sends typed text", () => {
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning={false} />)
    const ta = screen.getByRole("textbox")
    fireEvent.change(ta, { target: { value: "hello" } })
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true })
    expect(send).toHaveBeenCalledWith("hello")
  })

  test("empty Cmd+Enter is a no-op", () => {
    send.mockClear()
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning={false} />)
    const ta = screen.getByRole("textbox")
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true })
    expect(send).not.toHaveBeenCalled()
  })

  test("when isRunning=true, Stop replaces Send and fires interrupt", () => {
    wrap(<AgentComposer entity_ref="todoist:task:1" isRunning />)
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    expect(interrupt).toHaveBeenCalled()
  })
})
```

- [ ] **Step 11.3: Implement AgentComposer**

`app/src/components/agent/AgentComposer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react"
import { ArrowUp, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentPost } from "@/hooks/useAgentPost"
import { useRegisterComposer } from "@/contexts/AgentComposerContext"

export function AgentComposer({
  entity_ref,
  isRunning,
}: {
  entity_ref: string
  isRunning: boolean
}) {
  const [text, setText] = useState("")
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { send, interrupt } = useAgentPost(entity_ref)
  const register = useRegisterComposer()

  useEffect(() => {
    register({
      startModify: (option_id, option_label) => {
        // We send "MODIFY: <id>: <text>" on the wire; the user sees "Modify option <label>: "
        // We tag the prefix server-side by parsing "Modify option <id>: " — but we send the
        // raw text. For wire format, useAgentPost.modify handles "MODIFY:" wrapping. Here we
        // just pre-fill the visible textarea with a friendly prefix; on send, we route through
        // postModify if the text still starts with the prefix.
        setText(`Modify option ${option_label}: `)
        // Stash the id on a data-attribute so submit handler can route via modify().
        taRef.current?.setAttribute("data-modify-option-id", option_id)
        taRef.current?.focus()
      },
      focus: () => taRef.current?.focus(),
    })
    return () => register(null)
  }, [register])

  async function submit() {
    const value = text.trim()
    if (!value) return
    const modifyId = taRef.current?.getAttribute("data-modify-option-id") ?? null
    setText("")
    taRef.current?.removeAttribute("data-modify-option-id")
    if (modifyId) {
      // Strip the "Modify option <label>: " prefix if still present.
      const colonIdx = value.indexOf(":")
      const userText = colonIdx >= 0 ? value.slice(colonIdx + 1).trim() : value
      await send(`MODIFY: ${modifyId}: ${userText}`)
    } else {
      await send(value)
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={2}
        className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        placeholder="Ask a question or describe a modification…"
      />
      {isRunning ? (
        <Button
          type="button"
          aria-label="Stop"
          size="icon"
          className="rounded-full bg-rose-500/90 hover:bg-rose-500 text-white"
          onClick={() => void interrupt()}
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          aria-label="Send"
          size="icon"
          className="rounded-full"
          onClick={() => void submit()}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 11.4: Run test, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/AgentComposer.test.tsx
```

- [ ] **Step 11.5: Mount AgentComposer in the drawer**

Modify `app/src/components/agent/AgentDrawer.tsx` footer to use the real composer. Drawer needs `isRunning` from the runtime — pull via `useAgentRuntime`:

```tsx
import { useAgentRuntime } from "@/hooks/useAgentRuntime"
import { AgentComposer } from "./AgentComposer"

// Inside SheetContent (still wrapped in AgentComposerProvider):
function AgentDrawerBody({ entity_ref }: { entity_ref: string }) {
  const { isRunning } = useAgentRuntime(entity_ref)
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <AgentTranscript entity_ref={entity_ref} />
      </div>
      <div className="border-t p-3">
        <AgentComposer entity_ref={entity_ref} isRunning={isRunning} />
      </div>
    </>
  )
}

// And in AgentDrawer:
<AgentComposerProvider>
  {activeEntityRef ? <AgentDrawerBody entity_ref={activeEntityRef} /> : null}
</AgentComposerProvider>
```

NOTE: `useAgentRuntime` now gets called twice (once in AgentTranscript, once in AgentDrawerBody). Convex `useQuery` deduplicates by argument, so this is fine — but consider refactoring to a context if this annoys you later.

- [ ] **Step 11.6: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

- [ ] **Step 11.7: Smoke test**

Dev server. The drawer footer should now show a real textarea + Send button. Type "hi", ⌘+Enter. (Will fail to actually POST without `VITE_AGENTIC_ENGINE_URL` and `VITE_AGENTIC_ENGINE_TOKEN` set, but the UI swap to Stop won't trigger because seed status is awaiting_decision — that's correct.)

Click a Modify… on a proposal option. The textarea should pre-fill "Modify option B: " and focus.

- [ ] **Step 11.8: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/components/agent/AgentComposer.tsx app/src/components/agent/AgentComposer.test.tsx \
        app/src/contexts/AgentComposerContext.tsx app/src/components/agent/AgentDrawer.tsx
git commit --message "feat(agent): composer with Send/Stop swap + MODIFY pre-fill

Always-visible textarea + circular Send button. Cmd+Enter to send.
When isRunning, the button swaps to a rose Stop button calling
POST /run/:ref/interrupt. Modify… buttons on proposal options focus
the composer and pre-fill 'Modify option <label>: '; submit routes
through MODIFY: <id>: <text>."
```

---

## Task 12: Commit 9 (production build) — Status pill + thinking indicator

**Goal:** Drawer header shows the run status as a colored badge. While the agent is thinking, a 3-dot pulse + self-ticking elapsed timer appears at the end of the transcript.

**Files:**
- Modify (replace stub): `app/src/components/agent/StatusPill.tsx`
- Create: `app/src/components/agent/StatusPill.test.tsx`
- Modify (replace stub): `app/src/components/agent/ThinkingIndicator.tsx`
- Create: `app/src/components/agent/ThinkingIndicator.test.tsx`
- Modify: `app/src/components/agent/AgentDrawer.tsx` (mount StatusPill in header)
- Modify: `app/src/components/agent/AgentTranscript.tsx` (append ThinkingIndicator when isRunning)

- [ ] **Step 12.1: Implement StatusPill (test + impl)**

`app/src/components/agent/StatusPill.test.tsx`:

```tsx
import { describe, expect, test } from "vitest"
import { render, screen } from "@testing-library/react"
import { StatusPill } from "./StatusPill"

describe("StatusPill", () => {
  test("renders Thinking with pulse for discovering", () => {
    const { container } = render(<StatusPill status="discovering" />)
    expect(screen.getByText("Thinking")).toBeInTheDocument()
    expect(container.querySelector(".animate-pulse")).toBeTruthy()
  })

  test("renders Awaiting you for awaiting_decision (no pulse)", () => {
    const { container } = render(<StatusPill status="awaiting_decision" />)
    expect(screen.getByText("Awaiting you")).toBeInTheDocument()
    expect(container.querySelector(".animate-pulse")).toBeNull()
  })

  test("renders Error for error", () => {
    render(<StatusPill status="error" />)
    expect(screen.getByText("Error")).toBeInTheDocument()
  })

  test("renders Idle for idle", () => {
    render(<StatusPill status="idle" />)
    expect(screen.getByText("Idle")).toBeInTheDocument()
  })
})
```

`app/src/components/agent/StatusPill.tsx`:

```tsx
// Status-pill pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md

type Props = { status: string }

const MAP: Record<string, { label: string; cls: string; pulse: boolean }> = {
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground", pulse: false },
  discovering: { label: "Thinking", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30", pulse: true },
  awaiting_decision: { label: "Awaiting you", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", pulse: false },
  executing: { label: "Executing", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30", pulse: true },
  error: { label: "Error", cls: "bg-rose-500/15 text-rose-600 border-rose-500/30", pulse: false },
}

export function StatusPill({ status }: Props) {
  const conf = MAP[status] ?? { label: status, cls: "bg-muted text-muted-foreground", pulse: false }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${conf.cls} ${conf.pulse ? "animate-pulse" : ""}`}>
      {conf.label}
    </span>
  )
}
```

- [ ] **Step 12.2: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/StatusPill.test.tsx
```

- [ ] **Step 12.3: Implement ThinkingIndicator (test + impl)**

`app/src/components/agent/ThinkingIndicator.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { render, act } from "@testing-library/react"
import { ThinkingIndicator } from "./ThinkingIndicator"

describe("ThinkingIndicator", () => {
  test("renders 3 dots", () => {
    const { container } = render(<ThinkingIndicator startedAt={Date.now()} />)
    expect(container.querySelectorAll(".rounded-full")).toHaveLength(3)
  })

  test("elapsed timer text updates via direct DOM mutation (not React state)", () => {
    vi.useFakeTimers()
    const start = Date.now()
    const { container } = render(<ThinkingIndicator startedAt={start} />)
    const node = container.querySelector('[data-testid="elapsed"]') as HTMLElement
    const before = node.textContent
    act(() => vi.advanceTimersByTime(3000))
    expect(node.textContent).not.toBe(before)
    vi.useRealTimers()
  })
})
```

`app/src/components/agent/ThinkingIndicator.tsx`:

```tsx
// Pattern adapted from pingdotgg/t3code (MIT) - see THIRD_PARTY_NOTICES.md
// Source reference: apps/web/src/components/chat/MessagesTimeline.tsx (WorkingTimelineRow)

import { useEffect, useRef } from "react"

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}

export function ThinkingIndicator({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const update = () => {
      if (ref.current) ref.current.textContent = formatElapsed(Date.now() - startedAt)
    }
    update()
    // Self-mutate via setInterval — avoids re-rendering on every tick.
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-[3px]">
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
        <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
      </span>
      <span data-testid="elapsed" ref={ref}>0s</span>
    </div>
  )
}
```

- [ ] **Step 12.4: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ThinkingIndicator.test.tsx
```

- [ ] **Step 12.5: Mount StatusPill in the drawer header**

Modify `app/src/components/agent/AgentDrawer.tsx` header to include the pill. Read `run` via `useAgentRuntime` inside the body component (already present). To avoid plumbing, lift the runtime read into the drawer:

```tsx
// AgentDrawer.tsx full body now reads runtime once and passes both isRunning + status down
function AgentDrawerBody({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
  const startedAtRef = useRef<number | null>(null)
  if (isRunning && startedAtRef.current === null) startedAtRef.current = Date.now()
  if (!isRunning) startedAtRef.current = null

  return (
    <>
      <SheetHeader className="px-4 py-3 border-b flex items-center justify-between flex-row">
        <SheetTitle className="text-sm">
          <span className="font-mono text-xs text-muted-foreground">{entity_ref}</span>
        </SheetTitle>
        <StatusPill status={run?.status ?? "idle"} />
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-4">
        <AgentTranscript entity_ref={entity_ref} />
        {isRunning && startedAtRef.current && (
          <ThinkingIndicator startedAt={startedAtRef.current} />
        )}
      </div>
      <div className="border-t p-3">
        <AgentComposer entity_ref={entity_ref} isRunning={isRunning} />
      </div>
    </>
  )
}
```

Imports at top: `import { useRef } from "react"`, `import { StatusPill } from "./StatusPill"`, `import { ThinkingIndicator } from "./ThinkingIndicator"`.

- [ ] **Step 12.6: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

- [ ] **Step 12.7: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/components/agent/StatusPill.tsx app/src/components/agent/StatusPill.test.tsx \
        app/src/components/agent/ThinkingIndicator.tsx app/src/components/agent/ThinkingIndicator.test.tsx \
        app/src/components/agent/AgentDrawer.tsx
git commit --message "feat(agent): status pill + thinking indicator

Drawer header shows colored badge with pulse on discovering/executing.
While running, a 3-dot pulse + self-ticking elapsed timer (direct DOM
mutation, no re-renders) appears at the end of the transcript.
Patterns adapted from t3code (MIT)."
```

---

## Task 13: Commit 10 (production build) — Error state with retry

**Goal:** Render `kind: "error"` rows as an inline card with collapsible JSON details + Retry + Ask buttons.

**Files:**
- Modify (replace stub): `app/src/components/agent/ErrorState.tsx`
- Create: `app/src/components/agent/ErrorState.test.tsx`
- Modify: `app/src/components/agent/AgentTranscript.tsx` (render ErrorState for error rows)

- [ ] **Step 13.1: Write test**

`app/src/components/agent/ErrorState.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ErrorState } from "./ErrorState"

const retry = vi.fn()
const focus = vi.fn()

vi.mock("@/hooks/useAgentPost", () => ({
  useAgentPost: () => ({ send: vi.fn(), interrupt: vi.fn(), execute: vi.fn(), modify: vi.fn() }),
}))
vi.mock("@/contexts/AgentComposerContext", () => ({
  useAgentComposerHandle: () => ({ focus, startModify: vi.fn() }),
}))

describe("ErrorState", () => {
  test("renders message", () => {
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom" }} onRetry={retry} />)
    expect(screen.getByText("boom")).toBeInTheDocument()
  })

  test("expand details shows JSON", () => {
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom", details: { a: 1 } }} onRetry={retry} />)
    fireEvent.click(screen.getByText(/details/i))
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument()
  })

  test("Retry button fires onRetry", () => {
    retry.mockClear()
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom" }} onRetry={retry} />)
    fireEvent.click(screen.getByText(/retry/i))
    expect(retry).toHaveBeenCalled()
  })

  test("Ask focuses the composer", () => {
    focus.mockClear()
    render(<ErrorState entity_ref="todoist:task:1" error={{ message: "boom" }} onRetry={retry} />)
    fireEvent.click(screen.getByText(/ask the agent/i))
    expect(focus).toHaveBeenCalled()
  })
})
```

- [ ] **Step 13.2: Implement**

`app/src/components/agent/ErrorState.tsx`:

```tsx
import { useState } from "react"
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAgentComposerHandle } from "@/contexts/AgentComposerContext"

export type AgentError = { message: string; details?: unknown }

export function ErrorState({
  entity_ref: _entity_ref,
  error,
  onRetry,
}: {
  entity_ref: string
  error: AgentError
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const composer = useAgentComposerHandle()
  return (
    <div className="rounded-md border-l-4 border-l-rose-500 border border-border bg-rose-500/5 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
        <div className="flex-1 text-sm">
          <div className="font-medium">{error.message}</div>
          {error.details !== undefined && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              details
            </button>
          )}
          {open && (
            <pre className="mt-1 overflow-auto bg-background/60 p-2 rounded text-[11px] font-mono">
              {JSON.stringify(error.details, null, 2)}
            </pre>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
        <Button size="sm" variant="ghost" onClick={() => composer?.focus()}>Ask the agent</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 13.3: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/src/components/agent/ErrorState.test.tsx
```

- [ ] **Step 13.4: Wire ErrorState into the transcript**

Modify `app/src/components/agent/AgentTranscript.tsx` to replace the `if (r.kind === "error")` placeholder. The retry handler needs the prior turn's message — for v1, retry sends an empty `MODIFY: __retry__` and trusts the server to retry the last attempt; alternatively, retry re-fires `postRun` with `message: null` to trigger a fresh discovery. Use the latter (simpler, matches "retry the run" semantics):

```tsx
import { ErrorState } from "./ErrorState"
import { useAgentPost } from "@/hooks/useAgentPost"

// inside the row switch, replace error placeholder:
if (r.kind === "error") {
  const errObj = (r.error_json ?? { message: "Unknown error" }) as { message: string; details?: unknown }
  return (
    <ErrorRowWrapper key={r._id} entity_ref={entity_ref} error={errObj} />
  )
}

// outside the main component, add a small helper:
function ErrorRowWrapper({ entity_ref, error }: { entity_ref: string; error: { message: string; details?: unknown } }) {
  const { send } = useAgentPost(entity_ref)
  return (
    <ErrorState
      entity_ref={entity_ref}
      error={error}
      onRetry={() => { void send("") }} // send empty triggers server-side resume-from-last
    />
  )
}
```

NOTE: the exact retry semantic depends on what the engine does with an empty message on an existing run. Read the server spec's `message: null` handling (line 106 of the server design doc). If the engine rejects empty strings, change the retry handler to send a null message via a slightly different code path — verify in the smoke test.

- [ ] **Step 13.5: Validate**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

- [ ] **Step 13.6: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/components/agent/ErrorState.tsx app/src/components/agent/ErrorState.test.tsx \
        app/src/components/agent/AgentTranscript.tsx
git commit --message "feat(agent): error row with collapsible details + retry/ask

kind=error rows render as a rose-bordered card with a collapsible JSON
details pane and two actions: Retry (re-fire run) and Ask the agent
(focuses composer). Honours the spec's parking-lot note: when
agenticRuns.last_error lands, a full-drawer error variant can wire up
to render even when no row exists."
```

---

## Task 14: Commit 11 (production build) — Reserved seams + auto-trigger on open + integration test

**Goal:** Close out Phase 1. Add the auto-trigger on drawer mount (the `Idempotency-Key = entity_ref:open:mountId` flow). Land the integration test that walks the full happy path. Verify mobile responsiveness.

**Files:**
- Modify: `app/src/components/agent/AgentDrawer.tsx` (auto-trigger on mount)
- Create: `app/test/agent-drawer.integration.test.tsx`
- Modify: `convex/agentic/dev/seed.ts` (add a `seedEmptyEntity` mutation if not already there)

- [ ] **Step 14.1: Add auto-trigger on mount**

Modify `app/src/components/agent/AgentDrawer.tsx`. Inside `AgentDrawerBody`:

```tsx
import { useEffect, useMemo } from "react"
import { ulid } from "ulid"
import { postRun } from "@/lib/agent/engineClient"

function AgentDrawerBody({ entity_ref }: { entity_ref: string }) {
  const { run, isRunning } = useAgentRuntime(entity_ref)
  const startedAtRef = useRef<number | null>(null)
  if (isRunning && startedAtRef.current === null) startedAtRef.current = Date.now()
  if (!isRunning) startedAtRef.current = null

  // Auto-trigger on mount: idempotency key stable per mount.
  const mountId = useMemo(() => ulid(), [])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await postRun({
          entity_ref,
          message: null,
          idempotency_key: `${entity_ref}:open:${mountId}`,
          multitask_strategy: "enqueue",
        })
        if (cancelled) return
        if (res.accepted === false) {
          // No-op: existing run or rejected. Convex query already showing state.
        }
      } catch (err) {
        // Engine unreachable: render nothing extra; transcript shows last-known state.
        console.warn("[agent] auto-trigger failed", err)
      }
    })()
    return () => { cancelled = true }
  // Only re-fire if entity_ref changes — mountId is stable for the lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity_ref])

  // ...rest unchanged
}
```

- [ ] **Step 14.2: Write the integration test**

`app/test/agent-drawer.integration.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

// We mock the engine HTTP client and the Convex react query layer.
// The Convex queries are driven by a stubbed reactive value.

const postRunMock = vi.fn().mockResolvedValue({ run_id: "r1", status: "awaiting_decision", accepted: true })
const postInterruptMock = vi.fn().mockResolvedValue({ status: "idle" })

vi.mock("@/lib/agent/engineClient", () => ({
  postRun: postRunMock,
  postInterrupt: postInterruptMock,
}))

// Seed: emulate getThread returning the full happy-path thread.
const happyThread = [
  { _id: "m1", row_type: "message", sequence: 1, run_id: "r1", kind: "user_message",
    body_markdown: "What should I do?", proposal_json: null, error_json: null, token_usage: null, checkpoint_id: null },
  { _id: "p1", row_type: "message", sequence: 2, run_id: "r1", kind: "proposal",
    body_markdown: null,
    proposal_json: {
      kind: "proposal", summary: "Choose one", findings: ["x"],
      options: [{ id: "a", label: "Option A", description: "do A", confidence: 0.8, reversibility: "trivial" }],
      recommended_option_id: "a", free_text_allowed: true,
    },
    error_json: null, token_usage: null, checkpoint_id: "ck-1" },
]
const happyRun = { entity_ref: "todoist:task:int", status: "awaiting_decision", last_run_id: "r1" }

vi.mock("convex/react", () => ({
  useQuery: (fn: unknown, args: unknown) => {
    if (args === "skip") return undefined
    const fnStr = String(fn ?? "")
    if (fnStr.includes("getThread")) return happyThread
    if (fnStr.includes("getRun")) return happyRun
    return undefined
  },
}))

vi.mock("@/convex/_generated/api", () => ({
  api: { agentic: { queries: {
    getThread: { default: "stub.getThread" },
    getRun: { default: "stub.getRun" },
  } } },
}))

// Now import everything that uses the mocks.
const { AgentDrawer } = await import("@/components/agent/AgentDrawer")
const { AgentDrawerProvider, useAgentDrawer } = await import("@/contexts/AgentDrawerContext")

function Harness() {
  const { open } = useAgentDrawer()
  return <button onClick={() => open("todoist:task:int")}>open</button>
}

describe("agent drawer happy path", () => {
  test("open → transcript + proposal → Execute fires postRun", async () => {
    render(
      <AgentDrawerProvider>
        <Harness />
        <AgentDrawer />
      </AgentDrawerProvider>,
    )

    fireEvent.click(screen.getByText("open"))

    // Auto-trigger fired
    await waitFor(() => {
      expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
        entity_ref: "todoist:task:int",
        message: null,
      }))
    })

    // User message bubble + proposal card render
    expect(await screen.findByText("What should I do?")).toBeInTheDocument()
    expect(screen.getByText("Option A")).toBeInTheDocument()

    // Execute on the recommended option
    postRunMock.mockClear()
    fireEvent.click(screen.getByRole("button", { name: /^Execute$/ }))
    await waitFor(() => {
      expect(postRunMock).toHaveBeenCalledWith(expect.objectContaining({
        entity_ref: "todoist:task:int",
        message: "EXECUTE: a",
        multitask_strategy: "interrupt",
      }))
    })
  })
})
```

- [ ] **Step 14.3: Run, expect pass**

```bash
cd ~/Documents/GitHub/master-db
bun test app/test/agent-drawer.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 14.4: Manual mobile/responsive smoke test**

```bash
cd ~/Documents/GitHub/master-db
bun --cwd app run dev
```

Open the dev URL. In Chrome DevTools, toggle device emulation to iPhone 12 (or any narrow viewport). Open the agent drawer on a task. Verify:
- The Sheet renders full-width / appropriately bottom-sheeted on narrow viewports.
- Proposal option cards stack vertically.
- Composer textarea is reachable + not clipped by mobile keyboard simulation.

Stop dev server.

- [ ] **Step 14.5: Validate one last time**

```bash
cd ~/Documents/GitHub/master-db
bun run typecheck && bun run lint && bun test
```

Expected: all green.

- [ ] **Step 14.6: Commit**

```bash
cd ~/Documents/GitHub/master-db
git add app/src/components/agent/AgentDrawer.tsx app/test/agent-drawer.integration.test.tsx
git commit --message "feat(agent): auto-trigger on mount + integration test

On drawer mount, fires POST /run with message=null and a per-mount
idempotency key so the server discovers (or no-ops on an existing
run). Integration test exercises open → transcript + proposal card →
Execute → assert postRun called with EXECUTE: id."
```

---

## Task 15: Push branch and open PR

- [ ] **Step 15.1: Push and PR**

```bash
cd ~/Documents/GitHub/master-db
git push -u origin agentic-engine-ux
gh pr create --title "feat(agent): Phase 1 per-entity Agent drawer" \
  --body "Implements the spec at docs/superpowers/specs/2026-05-15-agentic-engine-ux-design.md.

Builds on assistant-ui's ExternalStoreRuntime, feeds messages from Convex reactive
queries, renders structured Proposals as per-option decision cards. Auto-triggers
discovery on drawer open. t3code patterns lifted with attribution (THIRD_PARTY_NOTICES.md).

Depends on the agentic engine server's Convex schema (already in main).

Reserved seams left in place for the burndown queue (Phase 2), notifications
(Phase 3), and the auto-execute rules editor (Phase 4)."
```

- [ ] **Step 15.2: Verify CI / review locally**

Once the PR is up, walk through the diff yourself one more time. Each commit should be independently reviewable. If a reviewer asks for changes, fix in new commits — don't amend.

---

## Self-review checklist (done at plan-write time)

- ✅ Spec section "Trigger" — covered by Task 6.9.
- ✅ Spec section "Drawer shell" — Task 6.3.
- ✅ Spec section "Auto-trigger on open" — Task 14.1.
- ✅ Spec section "Transcript" — Tasks 7, 8.
- ✅ Spec section "Work-log grouping" — Tasks 5c, 8.
- ✅ Spec section "Proposal card" — Task 10.
- ✅ Spec section "Decision mechanics" (Execute / Modify) — Tasks 10b, 10d, 11.
- ✅ Spec section "Composer" — Task 11.
- ✅ Spec section "Live thinking indicator" — Task 12.
- ✅ Spec section "Status pill" — Task 12.
- ✅ Spec section "Error state" — Task 13.
- ✅ Spec section "Reserved seams" — RewindButton (10d), tool-registry (4, 9), keyboard model (6), mobile (14.4), auto-execute hook is the `useAgentPost.execute` call which can route through `shouldAutoExecute` later — left unbuilt but the seam exists; cost meter is read but unused (token_usage left in convertMessage shape).
- ✅ Spec section "Data flow & idempotency" — Tasks 10a, 10b, 14.
- ✅ Spec section "Tech stack additions" — Tasks 1, 2, 4, 10b.
- ✅ Spec section "Prerequisite PRs" — Tasks 1, 2.
- ✅ Spec section "Build sequence" — Tasks 3–14 are the literal 11-commit sequence (Tasks 4–14 = commits 1–11; Task 3 = the spike).
- ✅ Spec section "Testing" — Tasks 5–14 each include co-located `*.test.ts`; Task 14 is the integration test.

**Open items the plan documented for the engineer to coordinate on:**

1. Step 6.8 — wiring `useAgentKeybindings` requires reading the existing `useTaskSelection` hook's return shape. The plan documents the dependency without prescribing the exact line.
2. Step 13.4 — the retry semantic when re-firing `postRun` with an empty/null message depends on engine behavior; engineer verifies in the smoke test and adjusts if engine rejects empty bodies.
3. The spec's open question "`agenticRuns.last_error` field" — not in v1 schema; plan does not depend on it, but flagged here for follow-up if a drawer-wide error variant is needed later.
