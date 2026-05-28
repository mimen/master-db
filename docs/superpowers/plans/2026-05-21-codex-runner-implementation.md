# Codex Alternate Coding Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agentic engine run discover-and-propose loads on OpenAI Codex as a per-run alternative to Claude, with all response-format logic shared and only a thin per-platform adapter.

**Architecture:** A thin `AgentAdapter` per platform (SDK lifecycle + raw-stream → neutral transcript translation) is wrapped by a shared `createRunner` harness that owns the proposal protocol, parsing, terminal-event derivation, and fallback. The engine holds a registry of runners keyed by `AgentId`; `/run` selects one and an agent-tagged resume cursor keeps follow-ups on the same agent.

**Tech Stack:** Bun + TypeScript (strict), Hono, Convex client, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, zod, vitest. Run tests from repo root: `bunx vitest run`. Validation gate: `bun run typecheck && bun run lint && bun test`.

**Design spec:** `docs/superpowers/specs/2026-05-21-codex-runner-design.md`

---

## File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `engine/src/runner/types.ts` | Add `AgentId`, `TranscriptEvent`, `TurnComplete`, `AdapterEvent`, `AdapterTurnInput`, `AgentAdapter` | Modify |
| `engine/src/runner/agentSelection.ts` | Pure: agent resolution + tagged-cursor wrap/unwrap | New |
| `engine/src/runner/proposalProtocol.ts` | `DEFAULT_SYSTEM`, `tryParseProposal`, `proposalToTerminalEvent` | New (extracted) |
| `engine/src/runner/createRunner.ts` | Shared harness: adapter → `AgentRunner` | New |
| `engine/src/runner/claudeAdapter.ts` | Claude adapter (refactor of `claudeSdkRunner.ts`) | New (replaces) |
| `engine/src/runner/codexAdapter.ts` | Codex adapter over `@openai/codex-sdk` | New |
| `engine/src/routes/run.ts` | Registry + agent selection + cursor wrap/unwrap; store agent in `backend` | Modify |
| `engine/src/routes/interrupt.ts` | (unchanged — queue resolves runner) | — |
| `engine/src/server.ts` | `runners` registry + `defaultAgent`; queue `onInterrupt` resolves by stored agent | Modify |
| `engine/package.json` | Add `@openai/codex-sdk` | Modify |
| `engine/README.md` | Document `agent` field, `codex login`, `~/.codex/skills` symlink | Modify |

Order matters: Tasks 1–3 build the agnostic core (no SDK risk), Task 4 refactors Claude onto it (behavior-preserving), Task 5 adds Codex, Task 6 wires selection end-to-end, Task 7 is parity + ops.

---

## Task 1: AgentId + agent-tagged cursor + resolver (pure, no SDK)

**Files:**
- Create: `engine/src/runner/agentSelection.ts`
- Test: `engine/src/runner/agentSelection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/runner/agentSelection.test.ts
import { describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  isAgentId,
  wrapCursor,
  unwrapCursor,
  resolveAgent,
} from "./agentSelection";

describe("agentSelection", () => {
  it("AGENT_IDS contains claude and codex", () => {
    expect(AGENT_IDS).toEqual(["claude", "codex"]);
  });

  it("isAgentId narrows valid ids", () => {
    expect(isAgentId("claude")).toBe(true);
    expect(isAgentId("codex")).toBe(true);
    expect(isAgentId("opencode")).toBe(false);
    expect(isAgentId(null)).toBe(false);
  });

  it("wrap/unwrap round-trips the inner cursor + agent", () => {
    const tagged = wrapCursor("codex", { thread_id: "t1" });
    expect(unwrapCursor(tagged)).toEqual({
      agent: "codex",
      cursor: { thread_id: "t1" },
    });
  });

  it("unwrapCursor returns null for an untagged/empty cursor", () => {
    expect(unwrapCursor(null)).toBeNull();
    expect(unwrapCursor({ thread_id: "t1" })).toBeNull();
  });

  it("resolveAgent: explicit request wins when no stored cursor", () => {
    expect(
      resolveAgent({ requested: "codex", storedCursor: null, defaultAgent: "claude" }),
    ).toEqual({ ok: true, agent: "codex" });
  });

  it("resolveAgent: falls back to stored cursor agent, then default", () => {
    const stored = wrapCursor("codex", { thread_id: "t1" });
    expect(
      resolveAgent({ requested: undefined, storedCursor: stored, defaultAgent: "claude" }),
    ).toEqual({ ok: true, agent: "codex" });
    expect(
      resolveAgent({ requested: undefined, storedCursor: null, defaultAgent: "claude" }),
    ).toEqual({ ok: true, agent: "claude" });
  });

  it("resolveAgent: explicit request conflicting with stored agent is a conflict", () => {
    const stored = wrapCursor("codex", { thread_id: "t1" });
    expect(
      resolveAgent({ requested: "claude", storedCursor: stored, defaultAgent: "claude" }),
    ).toEqual({ ok: false, conflict: { stored: "codex", requested: "claude" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/agentSelection.test.ts`
Expected: FAIL — cannot find module `./agentSelection`.

- [ ] **Step 3: Write minimal implementation**

```ts
// engine/src/runner/agentSelection.ts
export const AGENT_IDS = ["claude", "codex"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export function isAgentId(v: unknown): v is AgentId {
  return typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);
}

export interface TaggedCursor {
  agent: AgentId;
  cursor: unknown;
}

export function wrapCursor(agent: AgentId, cursor: unknown): TaggedCursor {
  return { agent, cursor };
}

export function unwrapCursor(v: unknown): TaggedCursor | null {
  if (
    typeof v === "object" &&
    v !== null &&
    "agent" in v &&
    "cursor" in v &&
    isAgentId((v as Record<string, unknown>).agent)
  ) {
    const t = v as { agent: AgentId; cursor: unknown };
    return { agent: t.agent, cursor: t.cursor };
  }
  return null;
}

export type ResolveResult =
  | { ok: true; agent: AgentId }
  | { ok: false; conflict: { stored: AgentId; requested: AgentId } };

export function resolveAgent(args: {
  requested: AgentId | undefined;
  storedCursor: unknown;
  defaultAgent: AgentId;
}): ResolveResult {
  const stored = unwrapCursor(args.storedCursor)?.agent ?? null;
  if (args.requested && stored && args.requested !== stored) {
    return { ok: false, conflict: { stored, requested: args.requested } };
  }
  return { ok: true, agent: args.requested ?? stored ?? args.defaultAgent };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/agentSelection.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/src/runner/agentSelection.ts engine/src/runner/agentSelection.test.ts
git commit -m "feat(engine): agent id + tagged-cursor resolver for runner selection"
```

---

## Task 2: Extract the shared proposal protocol

Move the response-format logic out of `claudeSdkRunner.ts` so no adapter owns it.

**Files:**
- Create: `engine/src/runner/proposalProtocol.ts`
- Test: `engine/src/runner/proposalProtocol.test.ts`
- Reference (copy from, do not yet delete): `engine/src/runner/claudeSdkRunner.ts:99-189` (`DEFAULT_SYSTEM`), `:449-460` (`tryParseProposal`), `:400-420` (kind→event mapping inside `normalize`).

- [ ] **Step 1: Write the failing test**

```ts
// engine/src/runner/proposalProtocol.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM,
  tryParseProposal,
  proposalToTerminalEvent,
} from "./proposalProtocol";

describe("proposalProtocol", () => {
  it("DEFAULT_SYSTEM mentions the <proposal> contract", () => {
    expect(DEFAULT_SYSTEM).toContain("<proposal>");
  });

  it("tryParseProposal extracts and validates a proposal block", () => {
    const text = `prose <proposal>{"kind":"proposal","summary":"s","options":[],"free_text_allowed":true}</proposal>`;
    const p = tryParseProposal(text);
    expect(p?.kind).toBe("proposal");
    expect(p?.summary).toBe("s");
  });

  it("tryParseProposal returns null for missing/invalid blocks", () => {
    expect(tryParseProposal("no block here")).toBeNull();
    expect(tryParseProposal("<proposal>not json</proposal>")).toBeNull();
    expect(
      tryParseProposal(`<proposal>{"kind":"bogus","summary":"x","options":[],"free_text_allowed":true}</proposal>`),
    ).toBeNull();
  });

  it("proposalToTerminalEvent maps kind → event type", () => {
    const cp = "cp-1";
    expect(
      proposalToTerminalEvent(
        { kind: "execution_result", summary: "done", options: [], free_text_allowed: false },
        cp,
      ),
    ).toEqual({ type: "execution_result", body_markdown: "done", checkpoint_id: cp });

    expect(
      proposalToTerminalEvent(
        { kind: "blocked", summary: "stuck", options: [], free_text_allowed: false },
        cp,
      ),
    ).toEqual({ type: "blocked", body_markdown: "stuck", checkpoint_id: cp });

    const proposal = { kind: "proposal", summary: "p", options: [], free_text_allowed: true } as const;
    expect(proposalToTerminalEvent(proposal, cp)).toEqual({
      type: "proposal",
      proposal,
      checkpoint_id: cp,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/proposalProtocol.test.ts`
Expected: FAIL — cannot find module `./proposalProtocol`.

- [ ] **Step 3: Write the implementation**

Create `engine/src/runner/proposalProtocol.ts`. Copy `DEFAULT_SYSTEM` verbatim from `claudeSdkRunner.ts` (lines 99–189), then add the two functions:

```ts
// engine/src/runner/proposalProtocol.ts
import { ProposalSchema, type Proposal } from "./proposalSchema";
import type { CanonicalTerminalEvent } from "./types";

export const DEFAULT_SYSTEM = `…`; // ← copy verbatim from claudeSdkRunner.ts:99-189

export function tryParseProposal(text: string): Proposal | null {
  const open = text.indexOf("<proposal>");
  const close = text.lastIndexOf("</proposal>");
  if (open === -1 || close === -1 || close < open) return null;
  const json = text.slice(open + "<proposal>".length, close).trim();
  try {
    const obj: unknown = JSON.parse(json);
    return ProposalSchema.parse(obj);
  } catch {
    return null;
  }
}

export function proposalToTerminalEvent(
  proposal: Proposal,
  checkpoint_id: string,
): CanonicalTerminalEvent {
  if (proposal.kind === "execution_result") {
    return { type: "execution_result", body_markdown: proposal.summary, checkpoint_id };
  }
  if (proposal.kind === "blocked") {
    return { type: "blocked", body_markdown: proposal.summary, checkpoint_id };
  }
  return { type: "proposal", proposal, checkpoint_id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/proposalProtocol.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add engine/src/runner/proposalProtocol.ts engine/src/runner/proposalProtocol.test.ts
git commit -m "feat(engine): extract shared proposal protocol module"
```

> Note: `claudeSdkRunner.ts` still has its own copies — they are removed in Task 4 when it becomes the adapter. Do not delete them yet; the file must keep compiling.

---

## Task 3: Adapter contract types + shared harness

**Files:**
- Modify: `engine/src/runner/types.ts` (append the adapter contract)
- Create: `engine/src/runner/createRunner.ts`
- Test: `engine/src/runner/createRunner.test.ts`

- [ ] **Step 1: Append adapter types to `types.ts`**

Add to the end of `engine/src/runner/types.ts`:

```ts
import type { AgentId } from "./agentSelection";

/** Non-terminal events an adapter emits — the neutral transcript vocabulary. */
export type TranscriptEvent = Exclude<CanonicalEvent, CanonicalTerminalEvent>;

/** Emitted exactly once at the end of an adapter turn. Not forwarded as-is. */
export interface TurnComplete {
  type: "turn_complete";
  final_text: string;
  usage?: TokenUsage;
  native_error?: { message: string; details?: unknown };
  session_id: string | null;
}

export type AdapterEvent = TranscriptEvent | TurnComplete;

export interface AdapterTurnInput {
  entity_ref: string;
  prompt: string;
  system_prompt: string;
  session_id: string | null;
}

export interface AgentAdapter {
  id: AgentId;
  run(input: AdapterTurnInput): AsyncIterable<AdapterEvent>;
  interrupt(entity_ref: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing harness test**

```ts
// engine/src/runner/createRunner.test.ts
import { describe, expect, it } from "vitest";
import { createRunner } from "./createRunner";
import type { AdapterEvent, AgentAdapter, CanonicalEvent } from "./types";

function fakeAdapter(events: AdapterEvent[]): AgentAdapter {
  return {
    id: "codex",
    async *run() {
      for (const e of events) yield e;
    },
    async interrupt() {},
  };
}

const PROPOSAL = `<proposal>{"kind":"proposal","summary":"s","options":[],"free_text_allowed":true}</proposal>`;

describe("createRunner harness", () => {
  it("forwards transcript events and derives the terminal proposal", async () => {
    const runner = createRunner(
      fakeAdapter([
        { type: "assistant_message", body_markdown: "thinking out loud" },
        { type: "turn_complete", final_text: PROPOSAL, session_id: "t1" },
      ]),
    );
    const seen: CanonicalEvent[] = [];
    const result = await runner.run({
      entity_ref: "todoist_task:1",
      resume_cursor: null,
      entity_payload: {},
      message: null,
      on_event: async (e) => void seen.push(e),
    });
    expect(seen.map((e) => e.type)).toEqual(["assistant_message", "proposal"]);
    expect(result.terminal.type).toBe("proposal");
    expect(result.resume_cursor).toEqual({ session_id: "t1" });
  });

  it("falls back to the accumulated transcript when final_text has no block", async () => {
    const runner = createRunner(
      fakeAdapter([
        { type: "assistant_message", body_markdown: PROPOSAL },
        { type: "turn_complete", final_text: "", session_id: "t1" },
      ]),
    );
    const result = await runner.run({
      entity_ref: "todoist_task:1",
      resume_cursor: null,
      entity_payload: {},
      message: null,
      on_event: async () => {},
    });
    expect(result.terminal.type).toBe("proposal");
  });

  it("emits a terminal error when no proposal parses", async () => {
    const runner = createRunner(
      fakeAdapter([
        { type: "turn_complete", final_text: "nope", session_id: "t1", native_error: { message: "max turns" } },
      ]),
    );
    const result = await runner.run({
      entity_ref: "todoist_task:1",
      resume_cursor: null,
      entity_payload: {},
      message: null,
      on_event: async () => {},
    });
    expect(result.terminal.type).toBe("error");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/createRunner.test.ts`
Expected: FAIL — cannot find module `./createRunner`.

- [ ] **Step 4: Write the harness**

```ts
// engine/src/runner/createRunner.ts
import { randomUUID } from "node:crypto";

import {
  DEFAULT_SYSTEM,
  proposalToTerminalEvent,
  tryParseProposal,
} from "./proposalProtocol";
import type {
  AgentAdapter,
  AgentRunInput,
  AgentRunResult,
  AgentRunner,
  CanonicalTerminalEvent,
} from "./types";

interface InnerCursor {
  session_id: string | null;
}

function isInnerCursor(v: unknown): v is InnerCursor {
  return typeof v === "object" && v !== null && "session_id" in v;
}

function buildUserPrompt(input: AgentRunInput): string {
  return JSON.stringify({
    entity_ref: input.entity_ref,
    entity_payload: input.entity_payload,
    user_message: input.message,
  });
}

export function createRunner(adapter: AgentAdapter): AgentRunner {
  return {
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const prev = isInnerCursor(input.resume_cursor) ? input.resume_cursor : null;
      let assistantBuffer = "";
      let finalText = "";
      let usage: CanonicalTerminalEvent extends never ? never : undefined | { input: number; output: number };
      let sessionId: string | null = prev?.session_id ?? null;
      let nativeError: { message: string; details?: unknown } | undefined;
      let terminal: CanonicalTerminalEvent | null = null;

      for await (const ev of adapter.run({
        entity_ref: input.entity_ref,
        prompt: buildUserPrompt(input),
        system_prompt: DEFAULT_SYSTEM,
        session_id: prev?.session_id ?? null,
      })) {
        if (ev.type === "turn_complete") {
          finalText = ev.final_text;
          sessionId = ev.session_id;
          nativeError = ev.native_error;
          continue;
        }
        if (ev.type === "assistant_message") assistantBuffer += ev.body_markdown;
        await input.on_event(ev);
      }

      const parsed = tryParseProposal(finalText) ?? tryParseProposal(assistantBuffer);
      if (parsed) {
        terminal = proposalToTerminalEvent(parsed, randomUUID());
      } else {
        terminal = {
          type: "error",
          error: nativeError ?? {
            message: "no parseable proposal in transcript",
          },
        };
      }
      await input.on_event(terminal);

      return { resume_cursor: { session_id: sessionId } satisfies InnerCursor, terminal };
    },
    interrupt: (entity_ref) => adapter.interrupt(entity_ref),
  };
}
```

> Implementation note: drop the unused `usage` placeholder above — `token_usage` rides on the `assistant_message` events the adapter emits, so the harness does not need it. Keep the harness free of any provider specifics.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/createRunner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add engine/src/runner/types.ts engine/src/runner/createRunner.ts engine/src/runner/createRunner.test.ts
git commit -m "feat(engine): adapter contract + shared run harness"
```

---

## Task 4: Refactor Claude into an adapter

Convert `claudeSdkRunner.ts` (an `AgentRunner`) into `claudeAdapter.ts` (an `AgentAdapter`): it must stop parsing proposals and instead yield transcript events + one `TurnComplete`.

**Files:**
- Create: `engine/src/runner/claudeAdapter.ts` (port of `claudeSdkRunner.ts`)
- Create: `engine/src/runner/claudeAdapter.test.ts` (port of `claudeSdkRunner.test.ts`)
- Delete: `engine/src/runner/claudeSdkRunner.ts`, `engine/src/runner/claudeSdkRunner.test.ts` (after server is rewired in Task 6 — see note)

- [ ] **Step 1: Create `claudeAdapter.ts` from the existing runner**

Start from `claudeSdkRunner.ts`. Apply these changes:
- Rename the factory to `createClaudeAdapter(opts): AgentAdapter` and set `id: "claude"`.
- Keep the SDK `query()` options (`systemPrompt` now comes from `input.system_prompt`, `permissionMode: "bypassPermissions"`, `cwd`, `additionalDirectories`, `settingSources: ["user"]`, `resume: input.session_id ?? undefined`).
- Change `run` to an `async *run(input: AdapterTurnInput): AsyncIterable<AdapterEvent>` generator. The existing `normalize()` already yields the transcript events for assistant/user/tool messages — keep it, but **remove the `isResultSuccess`/`isResultError` proposal branches from `normalize`** (those become `TurnComplete`).
- Track `final_text`, `usage`, `session_id`, `native_error` while iterating, then `yield { type: "turn_complete", ... }` once after the SDK iterable ends:
  - On `isInitSystemMessage` → capture `session_id`.
  - On `isResultSuccess(msg)` → `final_text = msg.result` (and usage if exposed).
  - On `isResultError(msg)` → `native_error = { message: 'agent terminated with ' + msg.subtype, details: msg.errors }` and `final_text = ""`.
- Remove `DEFAULT_SYSTEM`, `ProposalSchema`/`Proposal` import, `tryParseProposal`, and `proposalToTerminalEvent` usage — they live in `proposalProtocol.ts` now and are applied by the harness.
- Keep `interrupt(entity_ref)` (abort + delete session map entry).

Concrete generator skeleton (replace the body of the old `run`):

```ts
// engine/src/runner/claudeAdapter.ts  (key shape — port the helpers verbatim)
export function createClaudeAdapter(opts: ClaudeAdapterOpts = {}): AgentAdapter {
  const sessions = new Map<string, { session_id: string | null; abort: AbortController }>();

  return {
    id: "claude",
    async *run(input: AdapterTurnInput): AsyncIterable<AdapterEvent> {
      const ctx = sessions.get(input.entity_ref) ?? {
        session_id: input.session_id,
        abort: new AbortController(),
      };
      sessions.set(input.entity_ref, ctx);

      const iterable = query({
        prompt: input.prompt,
        options: {
          systemPrompt: input.system_prompt,
          permissionMode: opts.permissionMode ?? "bypassPermissions",
          model: opts.model,
          cwd: opts.cwd ?? DEFAULT_CWD,
          additionalDirectories: opts.additionalDirectories ?? DEFAULT_ADDITIONAL_DIRS,
          settingSources: opts.settingSources ?? DEFAULT_SETTING_SOURCES,
          resume: ctx.session_id ?? undefined,
          abortController: ctx.abort,
        },
      });

      const activityKeys = new Map<string, string>();
      let finalText = "";
      let nativeError: { message: string; details?: unknown } | undefined;

      for await (const msg of iterable) {
        for (const e of normalize(msg, activityKeys)) yield e; // transcript only now
        if (isInitSystemMessage(msg)) ctx.session_id = msg.session_id;
        if (isResultSuccess(msg)) finalText = msg.result;
        if (isResultError(msg)) {
          nativeError = { message: `agent terminated with ${msg.subtype}`, details: msg.errors };
        }
      }

      yield {
        type: "turn_complete",
        final_text: finalText,
        session_id: ctx.session_id,
        native_error: nativeError,
      };
    },
    async interrupt(entity_ref) {
      const ctx = sessions.get(entity_ref);
      if (ctx) {
        ctx.abort.abort();
        sessions.delete(entity_ref);
      }
    },
  };
}
```

Port all the existing type-narrowing helpers (`isAssistantMessage`, `isUserMessage`, `isInitSystemMessage`, `isResultSuccess`, `isResultError`, `isThinkingBlock`, `isToolUseBlock`, `isToolResultParam`) and the `normalize()` function **with its `isResultSuccess`/`isResultError` branches deleted** (those two branches are now handled in the generator loop above).

- [ ] **Step 2: Port the test to `claudeAdapter.test.ts`**

Copy `claudeSdkRunner.test.ts`. Update imports to `createClaudeAdapter`. Where the old test asserted a returned `terminal`/`resume_cursor`, instead drive the generator and assert: (a) the transcript `AdapterEvent`s for a mocked assistant/tool stream, and (b) that a final `TurnComplete` is emitted carrying `final_text` (the mocked `result.result`) and `session_id`. Proposal-derivation assertions move to `createRunner.test.ts` / `proposalProtocol.test.ts` (already covered in Tasks 2–3) — do not duplicate them here.

- [ ] **Step 3: Run the adapter test to verify it fails, then passes**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/claudeAdapter.test.ts`
First run (before implementing): FAIL. After Step 1 implementation: PASS.

- [ ] **Step 4: Verify the whole suite still compiles with both files present**

`claudeSdkRunner.ts` still exists and is still imported by `server.ts`; that's fine for now. Run: `cd ~/Documents/GitHub/master-db && bun run typecheck`
Expected: PASS (no references to deleted symbols yet).

- [ ] **Step 5: Commit**

```bash
git add engine/src/runner/claudeAdapter.ts engine/src/runner/claudeAdapter.test.ts
git commit -m "feat(engine): claude adapter on shared harness (behavior-preserving)"
```

> `claudeSdkRunner.ts` is deleted in Task 6 Step 6, right after `server.ts` stops importing it — keeping the build green between commits.

---

## Task 5: Codex adapter

**Files:**
- Modify: `engine/package.json` (dependency)
- Create: `engine/src/runner/codexAdapter.ts`
- Test: `engine/src/runner/codexAdapter.test.ts`

- [ ] **Step 1: Add the SDK and pin/verify the event shape (spike)**

```bash
cd ~/Documents/GitHub/master-db && bun --cwd engine add @openai/codex-sdk
```

Then verify the streamed-event taxonomy at the installed version — the adapter's translation depends on it. Write a throwaway spike (delete after) or read the installed `node_modules/@openai/codex-sdk` types:

```bash
cd ~/Documents/GitHub/master-db && cat engine/node_modules/@openai/codex-sdk/dist/*.d.ts | grep -nE "runStreamed|startThread|resumeThread|ThreadEvent|item|type:" | head -60
```

Record the actual event/item discriminators (e.g. `item.completed` with `item.type` ∈ {`agent_message`,`reasoning`,`command_execution`,…}) and adjust `translateEvent` in Step 3 to match. **Do not assume — confirm from the installed types.** Capture findings in a comment at the top of `codexAdapter.ts`.

- [ ] **Step 2: Write the failing test (against a faked SDK)**

```ts
// engine/src/runner/codexAdapter.test.ts
import { describe, expect, it, vi } from "vitest";

// Mock the SDK before importing the adapter.
const startThread = vi.fn();
const resumeThread = vi.fn();
vi.mock("@openai/codex-sdk", () => ({
  Codex: vi.fn(() => ({ startThread, resumeThread })),
}));

import { createCodexAdapter } from "./codexAdapter";
import type { AdapterEvent } from "./types";

function fakeThread(id: string, items: unknown[]) {
  return {
    id,
    runStreamed: () => ({
      async *events() {
        for (const it of items) yield it;
      },
    }),
  };
}

describe("codexAdapter", () => {
  it("translates a stream into transcript events + TurnComplete", async () => {
    // Shapes here MUST match what Step 1 recorded from the installed SDK.
    startThread.mockReturnValue(
      fakeThread("thread-1", [
        { type: "item.completed", item: { type: "agent_message", text: "hello" } },
        { type: "item.completed", item: { type: "agent_message", text: "<proposal>{}" } },
      ]),
    );
    const adapter = createCodexAdapter();
    const out: AdapterEvent[] = [];
    for await (const e of adapter.run({
      entity_ref: "todoist_task:1",
      prompt: "{}",
      system_prompt: "SYS",
      session_id: null,
    })) {
      out.push(e);
    }
    expect(out.some((e) => e.type === "assistant_message")).toBe(true);
    const last = out.at(-1);
    expect(last?.type).toBe("turn_complete");
    if (last?.type === "turn_complete") {
      expect(last.session_id).toBe("thread-1");
      expect(last.final_text).toContain("<proposal>");
    }
  });

  it("resumes an existing thread when session_id is provided", async () => {
    resumeThread.mockReturnValue(fakeThread("thread-1", []));
    const adapter = createCodexAdapter();
    // eslint-disable-next-line no-empty
    for await (const _ of adapter.run({
      entity_ref: "todoist_task:1",
      prompt: "{}",
      system_prompt: "SYS",
      session_id: "thread-1",
    })) {
    }
    expect(resumeThread).toHaveBeenCalledWith("thread-1");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/codexAdapter.test.ts`
Expected: FAIL — cannot find module `./codexAdapter`.

- [ ] **Step 4: Implement the adapter**

```ts
// engine/src/runner/codexAdapter.ts
// Event shapes verified against @openai/codex-sdk@<pinned> — see Task 5 Step 1.
import { Codex } from "@openai/codex-sdk";

import type {
  AdapterEvent,
  AdapterTurnInput,
  AgentAdapter,
  TranscriptEvent,
} from "./types";

const HOME = process.env.HOME ?? "";
const DEFAULT_CWD = `${HOME}/Documents`;

export interface CodexAdapterOpts {
  model?: string;
  workingDirectory?: string;
}

interface CodexSession {
  thread_id: string | null;
}

/** Translate one Codex stream item → a TranscriptEvent, or null to skip. */
function translateEvent(
  ev: unknown,
  activity: Map<string, string>,
): { transcript: TranscriptEvent | null; finalText?: string } {
  // Adjust the discriminants to the shapes recorded in Step 1.
  const e = ev as { type?: string; item?: { type?: string; text?: string; id?: string; output?: unknown; status?: string } };
  if (e.type === "item.completed" && e.item?.type === "agent_message") {
    const text = e.item.text ?? "";
    return { transcript: { type: "assistant_message", body_markdown: text }, finalText: text };
  }
  if (e.type === "item.completed" && e.item?.type === "reasoning") {
    return { transcript: { type: "reasoning", body_markdown: e.item.text ?? "" } };
  }
  if (e.type === "item.started" && e.item?.type === "command_execution") {
    const key = e.item.id ?? crypto.randomUUID();
    activity.set(key, key);
    return { transcript: { type: "tool_call_started", activity_key: key, name: "command_execution", input: e.item } };
  }
  if (e.type === "item.completed" && e.item?.type === "command_execution") {
    const key = e.item.id ?? "";
    return {
      transcript: {
        type: "tool_call_resolved",
        activity_key: activity.get(key) ?? key,
        status: e.item.status === "failed" ? "error" : "ok",
        output: e.item.output,
      },
    };
  }
  return { transcript: null };
}

export function createCodexAdapter(opts: CodexAdapterOpts = {}): AgentAdapter {
  const codex = new Codex();
  const sessions = new Map<string, CodexSession>();

  return {
    id: "codex",
    async *run(input: AdapterTurnInput): AsyncIterable<AdapterEvent> {
      const prior = sessions.get(input.entity_ref);
      const resumeId = input.session_id ?? prior?.thread_id ?? null;
      const thread = resumeId
        ? codex.resumeThread(resumeId)
        : codex.startThread({
            workingDirectory: opts.workingDirectory ?? DEFAULT_CWD,
            sandboxMode: "danger-full-access",
            skipGitRepoCheck: true,
          });

      // Codex base instructions = the shared protocol prompt.
      const prompt = `${input.system_prompt}\n\n${input.prompt}`;

      const activity = new Map<string, string>();
      let finalText = "";
      const { events } = thread.runStreamed(prompt);
      for await (const ev of events) {
        const { transcript, finalText: ft } = translateEvent(ev, activity);
        if (ft !== undefined) finalText = ft;
        if (transcript) yield transcript;
      }

      const thread_id = thread.id ?? resumeId;
      sessions.set(input.entity_ref, { thread_id });
      yield { type: "turn_complete", final_text: finalText, session_id: thread_id };
    },
    async interrupt(entity_ref) {
      // If the installed SDK exposes a per-thread abort, call it here.
      sessions.delete(entity_ref);
    },
  };
}
```

> Two items to confirm against the installed SDK in Step 1 and fix here: (1) how `system_prompt` is best supplied — as a `baseInstructions`/config option on `startThread` rather than prepended to the prompt, if the SDK supports it (preferred); (2) the real interrupt/abort API (AbortSignal on `runStreamed` vs a `thread.interrupt()`), wiring it into the `interrupt` method.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/runner/codexAdapter.test.ts`
Expected: PASS (2 tests). If the SDK shapes differ from the mock, fix `translateEvent` and the test mock together to match Step 1's findings.

- [ ] **Step 6: Commit**

```bash
git add engine/package.json engine/bun.lock engine/src/runner/codexAdapter.ts engine/src/runner/codexAdapter.test.ts
git commit -m "feat(engine): codex adapter over @openai/codex-sdk"
```

---

## Task 6: Wire the registry + selection end-to-end

**Files:**
- Modify: `engine/src/routes/run.ts`
- Modify: `engine/src/server.ts`
- Test: `engine/src/routes/run.test.ts` (extend)
- Delete: `engine/src/runner/claudeSdkRunner.ts` + its test (after rewire)

- [ ] **Step 1: Extend the run route — body field + registry + selection**

In `engine/src/routes/run.ts`:

1. Import: `import { type AgentId, isAgentId, resolveAgent, unwrapCursor, wrapCursor } from "../runner/agentSelection";`
2. Add to `RunBody`: `agent: z.enum(["claude", "codex"]).optional(),`
3. Change `RunRoutesDeps`:
   ```ts
   // remove: runner: AgentRunner;
   runners: Record<AgentId, AgentRunner>;
   defaultAgent: AgentId;
   ```
4. In `decideAndEnqueue`, after loading `existingRun`, resolve the agent and reject conflicts:
   ```ts
   const resolved = resolveAgent({
     requested: body.agent,
     storedCursor: existingRun?.resume_cursor ?? null,
     defaultAgent: deps.defaultAgent,
   });
   if (!resolved.ok) {
     return {
       status: 409,
       body: {
         entity_ref: body.entity_ref,
         run_id: existingRun?.last_run_id ?? null,
         status: existingRun?.status ?? "discovering",
         accepted: false,
         reason: `agent_conflict: in-progress on ${resolved.conflict.stored}`,
       },
     };
   }
   const agent = resolved.agent;
   ```
   Pass `agent` into `executeRun({ ..., agent })`.
5. In `executeRun` (add `agent: AgentId` to `ExecuteRunArgs`):
   - Set `backend: agent` in the `upsertRun` call (replaces hardcoded `"claude_sdk"`).
   - Unwrap the stored cursor before calling the runner, re-wrap after:
     ```ts
     const tagged = unwrapCursor(existingRun?.resume_cursor ?? null);
     const innerCursor = tagged?.cursor ?? null;
     // ...
     const result = await deps.runners[agent].run({
       entity_ref,
       resume_cursor: innerCursor,
       entity_payload: payload,
       message,
       on_event: onEvent,
     });
     nextResumeCursor = wrapCursor(agent, result.resume_cursor);
     ```
   - The `updateRunStatus({ ..., resume_cursor: nextResumeCursor ?? null })` call now stores the tagged cursor.

- [ ] **Step 2: Update `server.ts` wiring**

In `engine/src/server.ts`:
1. Replace `runner: AgentRunner` in `BuildServerOpts` with `runners: Record<AgentId, AgentRunner>;` and `defaultAgent: AgentId;` (import `AgentId`).
2. The per-entity queue `onInterrupt` must call the *recorded* agent's runner. Resolve from the stored cursor:
   ```ts
   const queue = createPerEntityQueue({
     onInterrupt: async (ref) => {
       const run = (await store.getRun(ref)) as { resume_cursor?: unknown } | null;
       const agent = unwrapCursor(run?.resume_cursor ?? null)?.agent ?? opts.defaultAgent;
       await opts.runners[agent].interrupt(ref);
     },
   });
   ```
   (import `unwrapCursor` from `../runner/agentSelection`; `store` is already created above the queue — if not, move `createConvexStore` above the queue.)
3. Pass `runners: opts.runners` into `createRunRoutes({ ..., runners: opts.runners, defaultAgent: opts.defaultAgent })` (remove `runner`).
4. In the `import.meta.main` block, replace `const runner = createClaudeSdkRunner();` with:
   ```ts
   import { createRunner } from "./runner/createRunner";
   import { createClaudeAdapter } from "./runner/claudeAdapter";
   import { createCodexAdapter } from "./runner/codexAdapter";
   // ...
   const runners = {
     claude: createRunner(createClaudeAdapter()),
     codex: createRunner(createCodexAdapter()),
   };
   ```
   and pass `runners, defaultAgent: "claude"` to `buildServer`.

- [ ] **Step 3: Extend `run.test.ts`**

Add cases (using the existing test harness / a fake `AgentRunner` registry):
- `POST /run` with `agent: "codex"` routes to the codex runner and stores `backend: "codex"`.
- A follow-up `POST /run` with `message` and no `agent`, on an entity whose stored cursor is tagged `codex`, routes to codex (stickiness).
- `POST /run` with `agent: "claude"` on an entity whose stored cursor is tagged `codex` returns `409` with `reason` starting `agent_conflict`.
- `POST /run` with `agent: "opencode"` returns `400` (zod enum rejection).

Provide a `runners` stub: `{ claude: spyRunner("claude"), codex: spyRunner("codex") }` where `spyRunner` records calls and returns a proposal terminal + a plain inner cursor; assert the route wraps it as `{ agent, cursor }` via `store.updateRunStatus`.

- [ ] **Step 4: Run the route tests**

Run: `cd ~/Documents/GitHub/master-db && bunx vitest run engine/src/routes/run.test.ts`
Expected: PASS (existing + 4 new cases).

- [ ] **Step 5: Update any other `buildServer` callers**

Search and fix every test that calls `buildServer({ runner })`:
Run: `cd ~/Documents/GitHub/master-db && grep -rn "runner:" engine/src --include=*.test.ts`
Replace each with `runners: { claude: <runner>, codex: <runner> }, defaultAgent: "claude"`.

- [ ] **Step 6: Delete the obsolete Claude runner and verify the full suite**

```bash
cd ~/Documents/GitHub/master-db
git rm engine/src/runner/claudeSdkRunner.ts engine/src/runner/claudeSdkRunner.test.ts
bun run typecheck && bun run lint && bun test
```
Expected: typecheck/lint clean; all tests PASS. Fix any dangling imports of `createClaudeSdkRunner`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): per-run agent selection via runner registry + tagged cursor"
```

---

## Task 7: Tool parity, docs, and parity smoke check

**Files:**
- Modify: `engine/README.md`
- Operational: `~/.codex/skills` symlink

- [ ] **Step 1: Give Codex the same skill library**

The Claude adapter loads `~/.claude/skills` (→ vault `ClaudeConfig/skills`) via `settingSources: ['user']`. Point Codex at the same source:

```bash
ls -la ~/.codex/skills            # currently only .system/
ln -s ~/Documents/milad-vault/ClaudeConfig/skills ~/.codex/skills/vault
ls -la ~/.codex/skills/vault | head
```
(If Codex expects skills flat in `~/.codex/skills` rather than a nested dir, symlink each skill or the dir contents per the installed Codex skills convention confirmed in Task 5 Step 1.)

- [ ] **Step 2: Audit data-grounding skills under Codex**

Identify the discovery skills the Claude adapter actually exercises (read-heavy: `airtable`, `obsidian-search`, `convex`, `todoist`). Confirm each runs under Codex as-is (CLI/script based, agent-agnostic). For any that don't resolve, note it as a follow-up MCP shim — do **not** block v1 on it. Record findings in the PR description.

- [ ] **Step 3: Manual parity run**

With the engine running locally, run the same fresh entity through both agents and compare:

```bash
TOKEN=$(op read op://Sol/agentic-engine/server_token)
curl -s -XPOST localhost:8787/run -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"entity_ref":"todoist_task:<id-A>","agent":"claude"}'
curl -s -XPOST localhost:8787/run -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"entity_ref":"todoist_task:<id-B>","agent":"codex"}'
```
Verify both produce schema-valid proposals with real tool-grounded findings (≥2 substantive tool calls each, per `DEFAULT_SYSTEM`). Note any grounding-quality gap.

- [ ] **Step 4: Update the README**

In `engine/README.md` document: the optional `agent` field on `POST /run` (`"claude"` default | `"codex"`), the `codex login` host prerequisite, and the `~/.codex/skills` symlink step. Add Codex to the tech-stack line.

- [ ] **Step 5: Commit**

```bash
git add engine/README.md
git commit -m "docs(engine): document codex agent option + parity setup"
```

---

## Self-review notes (author)

- **Spec coverage:** registry (T6), per-run `agent` + stickiness + conflict (T1+T6), shared harness/protocol (T2+T3), thin adapters with no proposal logic (T4+T5), full tool parity via skill symlink (T7), tests per layer (T1–T6), rollout default-claude (T6 Step 2), README (T7). All spec sections map to a task.
- **Cursor double-wrap guard:** the harness stores a plain `{ session_id }` inner cursor; the route wraps it once as `{ agent, cursor }`. The route always `unwrapCursor`s before calling the runner, so no nesting accrues across turns.
- **Open SDK items (carried from spec):** Codex stream event taxonomy, system-prompt injection mechanism, interrupt API, token-usage availability — all resolved empirically in Task 5 Step 1 and reflected in Steps 4/5. The plan deliberately front-loads that verification before the adapter is written.

---

## Future work (NOT in this plan — do not implement)

Recorded so the executing agent doesn't roll either of these into the current tasks. Both are deliberately out of scope; each becomes its own spec/plan when picked up.

- **Agent-picker UX.** How a human chooses `agent` (per-entity default, per-run override on the `AgentSurface`, an engine-wide setting) belongs to the `agent-mode-convergence` surface, not this engine plan. The backend contract is stable: `POST /run { agent? }`, 409 on conflict, recorded agent on the run.
- **Cross-agent context transfer.** The engine already persists the full thread agent-agnostically, so transfer is purely additive on top of what this plan delivers — **prompt-level history replay**, not SDK session resume. The two pieces, when ready: (a) a `POST /run/:entity_ref/handoff { to: AgentId }` route that clears the tagged cursor and writes a synthesized `user_message` summarizing the prior thread, and (b) a `renderThreadForHandoff(thread): string` helper next to `proposalProtocol.ts` so neither adapter knows about it. Tagged-cursor stickiness still wins for normal turns; handoff is a one-shot break-glass.
