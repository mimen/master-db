# Chat UX Library Survey — Agentic Engine UI

Date: 2026-05-15
Purpose: Pick a React component library to render Proposal-bearing agent threads inside Todoist task drawers + burndown queue. Stack constraints: React 18, Vite 7, TS strict, shadcn/ui (Radix + Tailwind v3), Wouter routing, Convex reactive queries as source of truth (we own the data, no library streaming hooks).

Companion to `2026-05-15-t3code-ux-deep-dive.md`. We are deliberately trying to beat their handrolled `react-markdown` baseline by adopting a primitives library — not a turnkey chatbot.

---

## 1. Top Recommendation — `@assistant-ui/react` with `ExternalStoreRuntime`

**Install as npm package.** Copy-in is not the model here; the value is in the primitives, which are pinned via semver. Use the shadcn registry only for the styled wrappers (the `Thread`, `Composer`, `MessagePart` shells in `@assistant-ui/styles` or the docs examples) — copy those into `src/components/ai/` so we own the Tailwind.

Why it's the right call:

- **React 18 supported.** `peerDependencies: react: "^18 || ^19"` confirmed from `packages/react/package.json`. No churn risk.
- **`ExternalStoreRuntime` is exactly our shape.** Adapter takes `{ messages, isRunning, onNew, onCancel, onAddToolResult, convertMessage }`. We pass the Convex query result straight in; we own state, the runtime owns rendering. Docs explicitly list "redux, zustand, tanstack-query, etc." as supported — Convex slots in identically.
- **Custom message kinds via `data-*` content parts.** Quote from docs: *"Supports data-* prefixed types (e.g. `{ type: "data-workflow", data: {...} }`) that are automatically converted to DataMessagePart."* Our `proposal` kind becomes `{ type: "data-proposal", data: { options, confidence, reversibility, side_effects } }` and renders via a registered `MessagePartByType` component. This is **the** feature most other libs lack — they hardcode `user | assistant | tool`.
- **First-class tool-call rendering.** `makeAssistantToolUI({ toolName, render })` per tool, with `ToolFallback` for unknowns. Built-in collapsible patterns in the styled examples. Maps cleanly to our "tool-call activity card" requirement.
- **Headless Radix-style primitives.** `Thread.Root`, `Thread.Viewport`, `Thread.Messages`, `Composer.Root`, `Composer.Input`, `Composer.Send`, `Composer.Cancel`, `ActionBar.Root`, `BranchPicker`, `MessagePart`. Built on `@radix-ui/react-primitive` and `@radix-ui/react-compose-refs` — same lineage as our existing Radix deps. `asChild` composition pattern.
- **Composer identity-swap built in.** `Composer.Send` and `Composer.Cancel` are sibling primitives gated by `isRunning` — exactly the send/stop swap we wanted.
- **Markdown.** Included in styled examples (react-markdown under the hood). Easy to swap.
- **Tailwind/shadcn theming.** Styled wrappers consume CSS variables; our `bg-card`, `text-muted-foreground`, etc. flow through unchanged.
- **Maintenance signal.** v0.14.2 shipped 2026-05-13 (two days ago). 10.1k stars. YC-backed. Active "Launch Week" March 2026 added multi-platform support. MIT.
- **No Next.js / RSC coupling.** Pure client React. Works under Vite + Wouter with zero adapter.

**One concrete risk:** assistant-ui's mental model assumes a single "running" agent per thread. Our agent is per-entity, fired off by Convex actions, with proposals arriving asynchronously. We map this by treating `isRunning` as `latestProposal == null && hasOpenInvocation`, which we already compute server-side. Verify in a spike before committing.

---

## 2. Runner-up — Vercel **AI Elements** (`ai-elements`, shadcn registry)

Pick this **if** we ever migrate from Convex-source-of-truth to AI SDK streaming. Reasons it's #2 not #1:

- Copy-in via shadcn CLI (`npx shadcn@latest add https://elements.ai-sdk.dev/...`) — we own the files. Nice.
- 2k stars, v1.9.0 (2026-03-12). MIT-ish (Vercel license file).
- **But:** every quickstart wires `useChat` from `@ai-sdk/react`. The components technically accept a `messages` array, but their `Message`, `Tool`, `Reasoning` parts assume the AI SDK `UIMessage` part shape. Custom kinds (our `proposal`) are second-class — you'd render them by checking `part.type === "data-proposal"` inside a custom switch *outside* the library's idioms.
- Examples and docs use `"use client"` and presume Next.js. It runs in Vite, but you're swimming upstream.
- No `ExternalStore`-style adapter; state ownership pattern is "let the SDK own it."

Pick AI Elements when streaming-first wins. Today, Convex-reactive wins.

---

## 3. Comparison Matrix

| Library | Stars / Last release | React 18 | Driven by external data | Custom msg kinds | Tool-call UI | Markdown | shadcn-friendly | License | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **@assistant-ui/react** | 10.1k / 2026-05-13 (v0.14.2) | Yes | **Yes — ExternalStoreRuntime** | **Yes — `data-*` parts** | Yes — `makeAssistantToolUI` + `ToolFallback` | Yes | Radix primitives, shadcn-style styled examples | MIT | **PICK** |
| **Vercel AI Elements** | 2k / 2026-03-12 (v1.9.0) | Likely (no explicit pin) | Partial — assumes `useChat` | Awkward — DIY switch on `part.type` | Yes — `Tool` component | Yes | shadcn registry copy-in | Vercel | Runner-up |
| **kibo-ui (AI)** | — | — | — | — | — | — | — | MIT | **Folded into AI Elements** (redirects to `ai-sdk.dev/elements`). Don't use separately. |
| **prompt-kit** | smaller | Likely | Assumes AI SDK | Limited | Basic | Yes | shadcn copy-in | MIT | Thinner subset of AI Elements; skip. |
| **shadcn-chat (jakobhoeg)** | 1.6k / 2025-01-05 | — | DIY | DIY | No | No | shadcn copy-in | MIT | **Unmaintained.** Author posted "no longer actively maintaining" notice. Skip. |
| **shadcn AI Chatbot block** | — | Yes | Yes (it's just markup) | DIY | DIY | DIY | Native shadcn block | MIT | Useful as visual reference for ours, not a library. |
| **@llamaindex/chat-ui** | 580 / 2025-08-28 | Likely | Hook-coupled to `useChat` | Custom widgets supported | Not documented | Yes (Tailwind) | Tailwind / shadcn-ish | MIT | Smaller ecosystem; weaker custom-kind story than assistant-ui. |
| **CopilotKit** | large | Yes | Headless via `useCopilotChat` | Tied to copilot actions | Built-in | Yes | Tailwind | MIT | Opinionated runtime + AG-UI protocol; would force us to model agent as a "copilot action." Wrong shape. **Skip.** |
| **Vercel AI SDK (`ai`, `@ai-sdk/react`)** | huge | Yes | Hooks only, no components | n/a | n/a | n/a | n/a | Apache-2.0 | Data layer, not UI. Keep on shelf for future streaming. |
| **llm-ui** | small | Yes | Throttling around stream | Custom block matchers | No | Yes | DIY | MIT | Niche — focused on smoothing streamed markdown. Not our problem. |
| **NLUX (`@nlux/react`)** | medium | Yes | Adapter pattern | Custom personas/messages | Limited | Yes | own CSS | MPL | Decent but smaller community, weaker primitives. |
| **react-chat-elements** | medium | Yes | Yes (prop-driven) | Render-prop | No | No | Bootstrap-ish CSS | MIT | Pre-LLM messenger UI. Won't carry agentic patterns. |
| **TanStack Chat** | — | — | — | — | — | — | — | — | Does not exist as of 2026-05-15. |

---

## 4. Do **Not** Do

- **Don't copy-in `jakobhoeg/shadcn-chat`.** Maintenance is dead. Tempting because it's MIT and Tailwind-friendly, but it predates the proposal/tool-call paradigm entirely. You'll out-grow it inside a week.
- **Don't adopt CopilotKit.** Its mental model (define `useCopilotAction`s, let copilot decide when to invoke) inverts our architecture, where Convex actions produce structured proposals that the human approves. Forcing our flow through CopilotKit's runtime would mean writing more glue than UI.
- **Don't take Vercel AI Elements unless you're also adopting AI SDK on the data side.** The components are coupled to `UIMessage` part shapes and `useChat`. Mixing Convex-as-source-of-truth with AI Elements primitives means you spend the savings on adapter code.
- **Don't roll your own from scratch (the t3code path).** That was the baseline we explicitly want to beat. The accessibility, focus management, auto-scroll, branch picking, and stop/cancel state machine that assistant-ui ships are weeks of work to replicate.
- **Don't use llamaindex/chat-ui as primary.** Smaller ecosystem, hook-coupled, less expressive custom-message story. Fine as supplementary reference.
- **Don't pin to React 19 prematurely.** assistant-ui supports both, but our app is React 18; staying there until ecosystem (Convex, Radix, etc.) settles is correct.

---

## 5. Migration Path If We Outgrow assistant-ui

The primitives are headless, so most of the cost of an exit is in the *styled* components we copy in — and those are ours by then.

1. **If we want native streaming**: keep our `proposal`/`tool` rendering, swap `ExternalStoreRuntime` for AI SDK's runtime adapter, or migrate to AI Elements. Our message-conversion code stays useful.
2. **If assistant-ui stops being maintained**: the primitives are thin wrappers over Radix primitives + Zustand. We can fork or replace primitive-by-primitive. The `Thread.Viewport`/`Thread.Messages`/`Composer.Root` shapes are conventional enough that a swap is mechanical.
3. **If we go multi-channel (CLI, mobile)**: assistant-ui already ships `@assistant-ui/react-ink` (terminal) as of March 2026, and React Native support is on their roadmap. Same runtime, different renderers — that's a continuation, not a migration.
4. **If our agent model becomes more autonomous and we want a copilot pattern**: revisit CopilotKit at that point. Today we're not building a copilot; we're building a structured-decision queue with a transcript.

---

## Concrete Next Step

Spike `ExternalStoreRuntime` + Convex inside `app/`:

```bash
cd app && bun add @assistant-ui/react
```

Wire `useExternalStoreRuntime({ messages: useQuery(api.threads.list, { entityId }) ?? [], onNew: (m) => mutation(api.threads.send, ...), convertMessage })`. Register a `MessagePart` component for `type === "data-proposal"` that renders the multi-option decision card. Register `makeAssistantToolUI` for each tool name. Drop the styled wrappers into `src/components/ai/` and re-skin with our shadcn tokens.

If the spike survives one entity's full thread (transcript + proposal + tool calls + decision), commit. Otherwise fall back to AI Elements with the awkward custom-switch.

---

## Sources

- [assistant-ui GitHub](https://github.com/assistant-ui/assistant-ui)
- [assistant-ui npm](https://www.npmjs.com/package/@assistant-ui/react) — peer deps `react: "^18 || ^19"`
- [ExternalStoreRuntime docs](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [assistant-ui Launch Week March 2026](https://www.assistant-ui.com/blog/2026-03-launch-week)
- [AI Elements GitHub](https://github.com/vercel/ai-elements) / [docs](https://elements.ai-sdk.dev/)
- [kibo-ui — now redirects to AI Elements](https://ai-sdk.dev/elements/components?ref=kibo)
- [shadcn-chat (jakobhoeg) — unmaintained notice](https://github.com/jakobhoeg/shadcn-chat)
- [prompt-kit](https://www.prompt-kit.com/chat-ui)
- [llamaindex chat-ui](https://github.com/run-llama/chat-ui)
- [CopilotKit](https://github.com/CopilotKit/CopilotKit)
