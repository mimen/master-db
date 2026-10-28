# Today queue design

The shape in one line: **a day-keyed build row in Convex is the only thing the build owns; every live behavior (slots, gaps, New since, Below the line, progress) is one pure classification over live summaries plus the existing triage-event log.** Regenerate and the 7:00 AM job are both just writes to that row; a worker beside the bridge picks them up. Nothing goes through the outbox.

## Problem

Comma needs a Today lens: an LLM-ranked, grouped plan of the day's conversations that stays live as Milad works through it. The product is locked (mock at `apps/imsg/docs/today-queue-mock.html`, task brief). The shape is non-obvious for five reasons the grounding surfaced.

1. The build is minute-long LLM work that must run on the Mini (loopback gateway), but the only existing client-to-Mini path, the outbox, executes one command at a time (`server/bridge/outbox.ts:55-103`), so a build inside a handler blocks every send.
2. A global outbox kind needs four hand-kept registrations (Convex, client, bridge, fixture), none checked by `HandlerMap`.
3. The rules the mock states ("keeps its slot", "drops out when they answer", "New since", "rank numbers keep their gaps", "progress carried across Regenerate") all depend on what happened *after* the build. `ChatSummary` has no "became Needs you at" field and flags only show the latest direction.
4. Live queries do not rerun on wall-clock time, so day rollover and stale builds need a changing argument or a write.
5. `queueOrder`/`groupByAge` would destroy LLM order; the Today branch must live at `deriveInboxModel`, and selection/holds/keyboard key on `guid` while the stored queue keys on `conversationId`.

One fact found while grounding changes the design: the Overlay already keeps a **triage clear log**. `ChatDirectory` records a `reply` event when Milad answers an open Needs you (`server/chat-directory.ts:239-247`) and a `dismiss` event on settle (`:489`); undo deletes the event (`server/db.ts:372`). `importOverlay` mirrors it into `comma_triage_events`, indexed `by_clearedAt` (`convex/schema/comma/index.ts:55`). That log answers "was this handled since the build?" and "how many settled today?" without any new write path.

## Usage (caller's view)

### Quickstart

```ts
// Client. Mounted once under ChatDirectoryProvider in app/_layout.tsx.
<TodayProvider>{children}</TodayProvider>

const today = useToday();          // { day, view, regenerate, busy }
const plan = planToday(today.view, allChats, { held, now });   // sections, toGo, settled
const header = todayHeader(today.view, plan);                   // discriminated header state
const place = classifyToday(today.view, chat, now);             // one chat's place, for the strip

// Mini. One line in startBridge; the worker owns claim, build, finish.
const todayWorker = startTodayWorker({ subscribe, port: ingest, build: (claim) => buildToday(buildDeps, claim) });

// launchd, 7:00 AM: requests the day's build if none exists, waits, exits 0 or 1 for hub.
//   /bin/zsh ~/Programming/Repos/hub/bin/run mini.launchd.com.milad.imsg-today -- … bun server/today/trigger.ts
```

### Call site 1: the list pane renders Today

```tsx
// client/src/components/conversation-list-pane.tsx
const today = useToday();
const [openFolds, setOpenFolds] = useState<ReadonlySet<TodaySectionKey>>(new Set());
const plan = planToday(today.view, allChats, { held, now });   // also feeds the Today tab count on every lens
const model = deriveInboxModel(allChats, filters, searchQuery, deepMatchGuids, browseGuids, refine,
  state === "today" ? { plan, openFolds } : undefined);
// Header slot (same place as offline banner and chips):
{state === "today" && <TodayHeaderCard header={todayHeader(today.view, plan)} onRegenerate={today.regenerate} />}
// Section rows: <InboxCell row={row} onToggleFold={(key) => setOpenFolds(toggle(openFolds, key))} />
// Tab count: counts.today = plan.toGo
```

### Call site 2: the thread's state strip

```tsx
// client/src/components/state-strip.tsx
const { view } = useToday();
const place = chat ? classifyToday(view, chat, now) : null;
const todayLine = place?.at === "ranked" ? { rank: place.rank, reason: place.reason } : null;
// stripCopy(chat, messages, now, todayLine) renders "#3 today · Guest list locks at 6 PM."
```

### Call site 3: Regenerate (header button and ⌘K "Regenerate today")

```ts
// client/src/hooks/use-today.tsx
const request = useMutation(todayApi.requestBuild);
const regenerate = () => request({ day, dayStart });   // idempotent while a build is queued or running
```

### Call site 4: the 7:00 AM trigger

```ts
// apps/imsg/server/today/trigger.ts (import.meta.main entry, run by launchd through hub/bin/run)
const { day, start } = todayWindow(Date.now());
const outcome = await awaitScheduledBuild(ingestPort(env), { day, dayStart: start }, { pollMs: 5_000, timeoutMs: 15 * 60_000 });
process.exit(outcome === "done" ? 0 : 1);
```

## Shape

### Data structures first

**One Convex row per Los Angeles day**, table `comma_today_queue` (the name the mock approved), index `by_day`.

```ts
// convex/schema/comma/validators.ts
export const todayGroup = v.object({ id: v.string(), title: v.string(), context: v.string() });
export const todayItem = v.object({
  conversationId: v.id("comma_conversations"),
  rank: v.number(),          // 1..n, dense in display order at build time; gaps appear only live
  group: v.string(),         // todayGroup.id
  reason: v.string(),
});
export const todayQueue = v.object({
  snapshotAt: v.number(),    // when the candidate read began; every "since the build" rule compares to this
  model: v.string(),
  brief: v.string(),
  groups: v.array(todayGroup),             // ≤ 6, in display order
  items: v.array(todayItem),               // ≤ 50
  openAtSnapshot: v.array(v.id("comma_conversations")), // every known Needs you at snapshot, before any cap
  readCount: v.number(),                   // threads the model read ("50 of 81 threads")
});
const source = v.union(v.literal("schedule"), v.literal("user"));
export const todayRun = v.union(
  v.object({ status: v.literal("requested"), attempt: v.number(), source, requestedAt: v.number() }),
  v.object({ status: v.literal("building"), attempt: v.number(), source, requestedAt: v.number(), startedAt: v.number() }),
  v.object({ status: v.literal("done"), attempt: v.number(), source, finishedAt: v.number() }),
  v.object({ status: v.literal("failed"), attempt: v.number(), source, failedAt: v.number(), error: v.string() }),
);
export const todayQueueFields = {
  day: v.string(),           // "2026-10-27", America/Los_Angeles
  dayStart: v.number(),      // that day's local midnight, epoch ms; the progress window
  run: todayRun,             // latest attempt
  queue: v.optional(todayQueue), // latest successful build for this day; absent until the first one lands
};
export const todayView = v.object({
  day: v.string(), dayStart: v.number(), run: todayRun, queue: v.union(todayQueue, v.null()),
  cleared: v.array(v.object({ conversationId: v.id("comma_conversations"), at: v.number() })), // latest clear per conversation since dayStart
});
```

Load-bearing decisions in the data:

- **`run` and `queue` are separate fields.** A Regenerate in flight leaves `queue` untouched, so "the current queue stays usable underneath" is structural. A failed Regenerate cannot erase a good morning queue. The day key means yesterday's queue is unreachable from today's query, so "never show yesterday's queue as today's" is also structural (per type-system-discipline).
- **The queue stores what the build decided, never live status.** No per-item `done` flag, no settled counter. Done, gaps, New since and progress are derived on read from live flags and `comma_triage_events` (single source of truth per invariant; derive instead of sync).
- **Item kind is derived, not stored.** An item is a queued Needs you iff its id is in `openAtSnapshot`; otherwise it was a queued Waiting.
- **`snapshotAt` is the claim time, not the publish time.** A settle during the 40-second LLM call has `clearedAt > snapshotAt`, so the new queue hides it on arrival ("settles made meanwhile carry over"). A thread that turns Needs you during the call is outside `openAtSnapshot`, so it lands in New since.
- **Ranks are assigned by the parser, not the model.** The model returns items in order; ranks are dense by construction.
- **`run.attempt` is the fencing token.** Every transition checks `(status, attempt)`, so a crashed or duplicate worker cannot overwrite a newer attempt (per make-operations-idempotent).

### The placement rule (the heart of the design)

One pure function decides where any live chat sits. The list, the tab count, the header, the strip and the fixture all call it.

```ts
// client/src/lib/today.ts
export type TodayPlace =
  | { at: "ranked"; rank: number; group: string; reason: string }
  | { at: "done"; rank: number; group: string; reason: string } // queued, then handled; a gap
  | { at: "new" }
  | { at: "below" }
  | { at: "settled"; clearedAt: number }
  | { at: "out" };

/**
 * needsYou = known && !spam && flags.unresponded (message-based; agent-only never counts).
 * handled  = cleared(c) >= queue.snapshotAt.
 *
 * queued, wasOpen (Needs you at build):  needsYou && !handled → ranked | needsYou → new | else → done
 * queued, !wasOpen (Waiting at build):    waiting && !handled → ranked | needsYou → new | else → done
 * not queued, needsYou:                   wasOpen && !handled → below  | else → new
 * otherwise:                              cleared today → settled      | else → out
 */
export function classifyToday(view: TodayView, chat: ChatSummary, now: number): TodayPlace {
  throw new Error("not implemented");
}
```

How each mock rule falls out of the table:

| Mock rule | Live event | Classification |
|---|---|---|
| Ranked thread gets a new message, keeps slot, unread dot | inbound on a queued Needs you | still `needsYou`, no clear event → `ranked`; unread dot is the live summary's |
| Reply removes a queued Needs you | `reply` triage event + flags flip to waiting | `done` (gap) |
| They answer again later | inbound after the reply | `needsYou` but `handled` → `new` |
| Queued Waiting drops out when they answer | flags flip to unresponded | `new` |
| Settle, then Undo | `dismiss` event inserted, then deleted | `done`, then back to `ranked` in the same slot |
| Turns Needs you after the build | not in `openAtSnapshot` | `new`, newest first |
| Build left it out | in `openAtSnapshot`, not queued | `below` (folded) |
| Progress carried across Regenerate | events since `dayStart`, independent of `snapshotAt` | settled count unchanged by a rebuild |

```ts
export type TodaySectionKey = "new" | `group:${string}` | "below" | "settled" | "fallback";
export interface TodaySection {
  key: TodaySectionKey;
  label: string;                 // "New since 7:00 AM" | group title | "Below the line" | "Settled today" | "Needs you"
  detail: string | null;         // group context line, or the fixed copy for new/below
  tone: "fresh" | null;
  foldable: boolean;             // below and settled start folded
  rows: { chat: ChatSummary; rank: number | null; reason: string | null }[];
}
export interface TodayPlan {
  mode: "queue" | "fallback";    // fallback: no queue today → one "Needs you" section in queueOrder
  sections: TodaySection[];      // empty sections omitted
  toGo: number;                  // ranked + new
  settled: number;               // known conversations with a clear since dayStart
}

/** Buckets classifyToday over the directory. Ranked by group order then rank; new by last message desc;
 *  below in queueOrder; settled by clearedAt desc. A held guid in `done` keeps its slot (desktop hold). */
export function planToday(view: TodayView | null | undefined, chats: readonly ChatSummary[],
  opts: { held: string | null; now: number }): TodayPlan { throw new Error("not implemented"); }

export type TodayHeader =
  | { kind: "loading" }
  | { kind: "unbuilt"; busy: TodayBusy | null }                        // "Today's queue builds at 7:00 AM" + Build now
  | { kind: "failed"; error: string; busy: TodayBusy | null }          // no queue today; Retry; list is the fallback
  | { kind: "queue"; builtAt: number; model: string; readCount: number; queued: number; brief: string;
      settled: number; toGo: number; cleared: boolean; newSince: number;
      busy: TodayBusy | null; lastError: string | null };              // a failed Regenerate over a good queue
export type TodayBusy = "queued" | "building";
export function todayHeader(view: TodayView | null | undefined, plan: TodayPlan): TodayHeader {
  throw new Error("not implemented");
}

/** Parses the query result into lookup structures once per result. Not a wire type re-export. */
export interface TodayView {
  day: DayKey; run: TodayRun; dayStart: number;
  queue: null | { snapshotAt: number; model: string; brief: string; groups: TodayGroup[]; readCount: number;
    items: ReadonlyMap<ConversationId, TodayItem>; openAtSnapshot: ReadonlySet<ConversationId> };
  cleared: ReadonlyMap<ConversationId, number>;
}
export function toTodayView(row: FunctionReturnType<typeof todayApi.get>): TodayView | null {
  throw new Error("not implemented");
}
```

`toGo`, `settled`, `cleared` and the rank gaps come from the same pass, so the tab count, the header's "N settled · M to go" and the list can never disagree.

### Shared rules

```ts
// apps/imsg/shared/today.ts — imported by Convex, the Mini and the client
export type DayKey = string & { readonly __brand: "DayKey" };
export const TODAY_TIME_ZONE = "America/Los_Angeles";
export const TODAY_LIMITS = { groups: 6, items: 50, waitingMaxAgeMs: 7 * 86_400_000, messages: 30, read: 120 } as const;

/** The LA calendar day containing `now` and its local midnight. Pure Intl; DST-correct. */
export function todayWindow(now: number): { day: DayKey; start: number } { throw new Error("not implemented"); }

/** Build-input rule: known, not spam, message-based. Needs you at any age; Waiting under 7 days. */
export function todayCandidateState(
  c: { flags: ChatFlags; known: boolean; isSpam: boolean; lastMessageAt: number }, now: number,
): "needsYou" | "waiting" | null { throw new Error("not implemented"); }

// apps/imsg/shared/chat-state.ts — moved out of the client adapter so Convex computes `known` identically
export const knownParticipants = (participants: readonly { name: string | null }[]): boolean =>
  participants.some((p) => p.name !== null);
```

### Convex: `convex/comma/today.ts`

Two public functions for the client, one secret-guarded subscription for the Mini, four ingest routes, one scheduled expiry.

```ts
/** Authed. The day's row with the clear log since dayStart, or null before anything was requested. */
export const get = query({ args: { day: v.string() }, returns: v.union(todayView, v.null()), handler: notImplemented });

/** Authed. Requests a build. A no-op while requested or building; otherwise attempt+1. Creates the row on first use. */
export const requestBuild = mutation({ args: { day: v.string(), dayStart: v.number() }, returns: todayRun, handler: notImplemented });

/** bridgeKey-guarded, like pendingOutbox. The newest row's run if it is `requested`, else null. */
export const pendingBuild = query({ args: { bridgeKey: v.string() },
  returns: v.union(v.object({ day: v.string(), attempt: v.number() }), v.null()), handler: notImplemented });

// Ingest routes (bridge secret). Mutations only because ingest dispatches mutations.
/** 7:00 AM. Requests only when the day has no row yet; every call returns the current run. Poll-safe. */
export const todaySchedule = internalMutation({ args: { day: v.string(), dayStart: v.number() }, returns: todayRun, handler: notImplemented });
/** requested(attempt) → building. Returns startedAt (the snapshot time) or null if fenced out. Schedules expiry. */
export const todayClaim = internalMutation({ args: { day: v.string(), attempt: v.number() },
  returns: v.union(v.object({ startedAt: v.number() }), v.null()), handler: notImplemented });
/** One page of candidates by lastMessageAt desc, projected with withConversationState and todayCandidateState. */
export const todayCandidates = internalMutation({ args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  returns: v.object({ page: v.array(todayCandidate), continueCursor: v.string(), isDone: v.boolean() }), handler: notImplemented });
/** building(attempt) → done (writes queue) or failed. Replaying the same terminal outcome is a no-op. */
export const todayFinish = internalMutation({ args: { day: v.string(), attempt: v.number(),
  outcome: v.union(v.object({ ok: v.literal(true), queue: todayQueue }), v.object({ ok: v.literal(false), error: v.string() })) },
  returns: v.boolean(), handler: notImplemented });

/** Scheduled at request (+10 min) and claim (+8 min). Fails the run if it is still in that state and attempt. */
export const expireRun = internalMutation({ args: { day: v.string(), attempt: v.number(), status: v.union(v.literal("requested"), v.literal("building")) },
  returns: v.null(), handler: notImplemented });

const todayCandidate = v.object({
  conversationId: v.id("comma_conversations"), title: v.string(), isGroup: v.boolean(),
  state: v.union(v.literal("needsYou"), v.literal("waiting")), lastMessageAt: v.number(), unreadCount: v.number(),
  crm: v.optional(conversationCrmView),
});
```

Why the expiry is a scheduled write: the live query cannot notice that time passed (constraint 4). Following the `presence.expireTyping` precedent (`convex/comma/presence.ts:33-71`), a stuck request ("the Mini didn't pick it up") or a dead worker ("the build timed out") becomes a stored `failed` run, which the header renders and the 7:00 AM trigger reads as exit 1. No client timer and no reclaim logic.

`get` reads one row by `by_day` plus `comma_triage_events` `by_clearedAt >= dayStart`, reduced to the latest `clearedAt` per conversation. A day's clears are tens of rows.

Day rollover: `TodayProvider` computes `todayWindow(Date.now())` and sets a timeout for the next LA midnight, so the `day` argument changes and the subscription moves to the new row (constraint 4).

Registration: `comma_today_queue` in `convex/schema/comma/index.ts`; four keys in `ROUTES` (`convex/comma/ingest.ts`); `withConversationState`, `listReader` and the CRM projection exported from `convex/comma/queries.ts` unchanged; `today` added to `commaModules` in `convex/comma/testModules.vitest.ts`.

### Mini: `apps/imsg/server/today/`

The worker lives in `comma:server`, started from `startBridge` beside the outbox (same enablement: bridge secret plus background services). It never touches the outbox executor, so sends are never blocked (constraint 1) and no global kind is added anywhere (constraint 3).

```ts
// worker.ts
export interface TodayPort {
  post(route: "todayClaim", body: { day: string; attempt: number }): Promise<{ startedAt: number } | null>;
  post(route: "todayFinish", body: TodayFinishBody): Promise<boolean>;
  // build.ts also uses: todayCandidates, agentContext, agentPeople (existing routes, reused as-is)
}
/** Subscribes to pendingBuild. Single flight: one build at a time; a request seen mid-build is re-read after.
 *  Claims, runs `build`, posts finish. Any thrown error becomes a failed outcome. */
export function startTodayWorker(deps: {
  subscribe: (receive: (pending: { day: string; attempt: number } | null) => void) => () => void;
  port: TodayPort;
  build: (claim: TodayClaim) => Promise<TodayOutcome>;
  log?: (line: string) => void;
}): { stop(): void } { throw new Error("not implemented"); }

// build.ts
export type TodayClaim = { day: string; attempt: number; startedAt: number };
export type TodayOutcome = { ok: true; queue: TodayQueueInput } | { ok: false; error: string };
export interface TodayBuildDeps {
  port: TodayReadPort;                      // todayCandidates + agentContext + agentPeople, over ConvexIngest.request
  gateway: Pick<Gateway, "completeStructured">;
  profile: () => Promise<string>;           // loadProfile(config.vaultPath)
  now: () => number;
}
/** Reads every candidate page, caps at TODAY_LIMITS.read (Needs you first, then Waiting, newest first),
 *  fetches 30 messages and people per read thread (concurrency 8), makes ONE Opus 5.5 call, parses,
 *  and returns the queue with snapshotAt = claim.startedAt and openAtSnapshot = every needsYou id seen. */
export async function buildToday(deps: TodayBuildDeps, claim: TodayClaim): Promise<TodayOutcome> {
  throw new Error("not implemented");
}

// prompt.ts
export interface TodayThread { ref: string; candidate: TodayCandidate; people: AgentPerson[]; messages: ThreadMessage[] }
export function renderTodayPrompt(input: { threads: TodayThread[]; profile: string; now: number }): { system: string; prompt: string } {
  throw new Error("not implemented");
}
export const TODAY_SCHEMA: JSONSchema;      // { brief, groups[{id,title,context}], items[{ref,group,reason}] }
/** The LLM trust boundary. Never throws. */
export function parseTodayOutput(raw: unknown, refs: ReadonlyMap<string, ConversationId>):
  { ok: true; draft: { brief: string; groups: TodayGroup[]; items: TodayItem[]; dropped: number } } | { ok: false; error: string } {
  throw new Error("not implemented");
}

// trigger.ts
/** Calls todaySchedule until the run is done or failed. Exits on timeout as failed. */
export async function awaitScheduledBuild(port: Pick<ConvexIngest, "request">, day: { day: string; dayStart: number },
  opts: { pollMs: number; timeoutMs: number; sleep?: (ms: number) => Promise<void> }): Promise<"done" | "failed"> {
  throw new Error("not implemented");
}
```

**Candidate read.** From Convex, not the local `ChatDirectory`: Convex rows carry the `conversationId` the client joins on (constraint 5), the same `computeFlags` the client sees, and conversation-wide messages; the local directory has merged-sibling GUIDs and a known stale-`lastMessage` problem (`server/chat-directory.ts:463-517`). Context reuses the existing `agentContext` (limit 30) and `agentPeople` (notes, priority, tags, events) routes unchanged. About 80 threads cost about 160 small ingest calls at concurrency 8, a few seconds, once a day.

**Prompt.** `system` holds the role, the output rules (1 to 2 sentence brief; up to 6 groups with a title and one line of context; up to 50 items, each one line of reason under about 15 words; rank by what has a clock today, what blocks other people, money, and people Milad cares about), the current LA date and time, and the vault profile. `prompt` holds one block per thread, refs `c1..cN` instead of Convex ids (shorter, and a hallucinated id cannot resolve):

```
<thread ref="c12" state="needs_you" since="2d" unread="3" kind="dm">
Alex Rivera · CRM priority 1 · favorite · tags: artist · events: Friday at the Observatory (2026-10-30)
notes: <first 400 chars, neutralized>
<messages, oldest first, via agent/context.ts formatMessages, each text clipped to 400 chars, neutralized>
</thread>
```

Everything from a correspondent goes through `neutralize()` (`server/ai/context.ts`) under the existing untrusted-data notice. The model never sees a Convex id or anything it could echo into storage unvalidated.

**Validation in `parseTodayOutput`.** brief is required (trim, collapse whitespace, clip 300). groups keep the first 6 with a unique id and a non-empty title (clip 48 for the title, 160 for context). items walk in order and drop an unknown ref, a repeated ref, an unknown group or an empty reason (clip 120), then stop at 50. Groups left without items drop. Display order is groups by first appearance, items stable within a group; ranks are then 1..n down that order. Zero usable items with candidates present is a failure. `dropped` is logged. Limits sit in the prompt and the parser, not the JSON Schema, since `maxItems` support in structured output is uncertain.

**The one call.** `gateway.completeStructured(prompt, TODAY_SCHEMA, { model: "claude-opus-5-5", system, maxTokens: 16_000, timeoutMs: 300_000, effort: "medium" })`. Two small `Gateway` changes: `StructuredOptions` gains `system?: string`, and the adaptive-thinking branch (`server/ai/gateway.ts:178`) matches a `THINKING_MODELS` set containing `claude-opus-5` and `claude-opus-5-5`, so effort is forwarded. Failure kinds map to header copy in one table in `build.ts`: timeout becomes "The gateway timed out", provider becomes "Opus 5.5 was unavailable", invalid-output becomes "The answer didn't parse", shared becomes "The AI gateway is down". With no gateway key, `build` fails fast with "AI gateway not configured" instead of the worker not starting, so the header says why.

**Wiring.** `server/app.ts` builds `TodayBuildDeps` from the `Gateway` and `config.vaultPath` it already owns and passes them to `startBridge`. `startBridge` subscribes with its existing `ConvexClient` (`onUpdate(pendingBuild, { bridgeKey })`) and posts through its `ConvexIngest.request` (the agent-runner precedent, `server/agent/convex-port.ts`; no `Bodies`/`Results` entries needed). `stopModules()` stops it.

**Ops.** The new template `apps/imsg/scripts/launchagents/com.milad.imsg-today.plist.template` uses `StartCalendarInterval` Hour 7 Minute 0 with no KeepAlive and no RunAtLoad. Its ProgramArguments are `/bin/zsh <HOME>/Programming/Repos/hub/bin/run mini.launchd.com.milad.imsg-today -- /bin/zsh -lc 'cd <REPO>/apps/imsg && exec -a comma:today bun server/today/trigger.ts'`, and it logs to `~/Library/Logs/comma-today.log`. Bun loads `apps/imsg/.env` (`CONVEX_SITE_URL`, `COMMA_BRIDGE_SECRET`) from the working directory. `install-mini-launchagents.sh` renders it with the same placeholders. Its post-install argv-identity check covers resident processes only, so the calendar job is excluded from that check and verified with `launchctl print` instead. The hub job `mini.launchd.com.milad.imsg-today` is registered per `references/jobs.md`. launchd runs a missed calendar slot on wake, and `todaySchedule` is a no-op once the day has a row, so a late or repeated fire is harmless. If `comma:server` is down at 7:00, the request waits, the expiry fails it after 10 minutes, the trigger exits 1, and hub shows the failure.

### Client

| File | Change |
|---|---|
| `apps/imsg/shared/types.ts` | `StateFilter` gains `"today"`; `StateCounts` follows. |
| `apps/imsg/shared/chat-state.ts` | `matchesFilters` `case "today": return false` with a one-line note that Today membership is a plan over the directory, not a per-chat predicate. `knownParticipants` lives here. |
| `client/src/lib/today.ts` | `toTodayView`, `classifyToday`, `planToday`, `todayHeader`. Pure. |
| `client/src/hooks/use-today.tsx` | `TodayProvider`: LA day clock with midnight timeout, `useQuery(todayApi.get, { day })` memoized through `toTodayView`, `regenerate` via `useMutation(todayApi.requestBuild)`. Mounted in `app/_layout.tsx` inside `ChatDirectoryProvider`. |
| `client/src/lib/convex-api.ts` | `todayApi` typed `anyApi` refs for `comma/today:get` and `comma/today:requestBuild`. |
| `client/src/lib/inbox-model.ts` | `Lens` and `LENSES` get `{ value: "today", label: "Today", count: "turn" }` first. Title registry gets "Today". `InboxRow` section gains `detail`, `tone`, `fold: "open" \| "closed" \| null`; chat rows gain `today?: { rank; reason }`. `deriveInboxModel` gains a trailing `today?: { plan; openFolds }`: with no search it flattens `plan.sections`, emitting a folded section's header without its chats, so `navigationEntries` skips them. No `queueOrder`/`groupByAge` touches ranked rows (constraint 6). |
| `client/src/components/today-header.tsx` | Renders `TodayHeader`: date, Regenerate (or Build now / Retry; disabled with "Regenerating" while busy), meta line, brief, "N settled · M to go". |
| `client/src/components/conversation-list-pane.tsx` | Plan, fold state, header slot, Today tab count from `plan.toGo`. No People chip on Today; it is Known by definition. |
| `client/src/components/chat-row.tsx` | Leading rank number and a sparkle reason line when `today` is set; live avatar, unread, settle unchanged. |
| `client/src/lib/state-strip.ts`, `components/state-strip.tsx` | An optional `today` line ("#3 today" plus reason) from `classifyToday`, shown in any lens. |
| `client/src/components/messages-workspace.tsx` | Starts on `"today"`. The hold applies to the selected chat on Today; auto-advance on settle includes Today. |
| `client/src/lib/desktop-coordinator/reducer.ts` | Initial state `"today"`. |
| `client/src/lib/palette/model.ts` | Lens command "Today" (the exhaustive `Record<StateFilter,…>` forces it) and an action "Regenerate today". ⌘1 becomes Today; others shift by one (array-indexed already). |

The join is by `conversationId` inside `classifyToday`; every row it emits is the live `ChatSummary`, so selection, holds and keyboard keep using `guid` (constraint 5). Agent-only Needs you conversations never enter ranked, new or below because `needsYou` is message-based (constraint 7). The fallback mode is literally the Needs you lens in `queueOrder`, agents included, under one section.

### Fixture

- `apps/imsg/e2e/fixture/world.ts` adds `TODAY_SEED`: a queue over existing fixture conversations (fixture ids are chat GUIDs), `snapshotAt = FIXTURE_NOW - 2h`, so seeded later inbound chats show in New since. Three groups, one Waiting item, two Needs you left below the line.
- `apps/imsg/e2e/fixture/convex.ts` adds handlers `"comma/today:get"`, which serves the store for any `day` with `cleared` derived from the fixture OverlayDb's triage events (the conversation id is the chat GUID), and `"comma/today:requestBuild"`, which sets `building`, then after 300 ms ranks the current known Needs you chats newest first into two fixed groups and sets `done`. A `todayMode: "seeded" | "unbuilt" | "failed"` option drives the header states. The store resets in the cleanup function. No outbox kind and no global-kind allowlist edit.

### Tests (one per module, behavior not implementation)

- `apps/imsg/shared/today.test.ts`: `todayWindow` across both DST transitions and at 23:59/00:00 LA; `todayCandidateState` at the 7-day boundary, for spam, for unknown, and for agent-only.
- `convex/comma/today.test.ts` (convex-test): `requestBuild` no-op while requested or building and attempt+1 after done or failed; `todaySchedule` requests only for a new day and is poll-safe; claim and finish are fenced by attempt and replay-safe; `expireRun` fails only a matching stuck run; `get` returns `cleared` since `dayStart`, latest per conversation, and drops an undone clear; unauthenticated `get`/`requestBuild` and a bad `bridgeKey` are rejected; `todayCandidates` pages and applies the rule.
- `apps/imsg/server/today/prompt.test.ts`: every drop rule, dense ranks in display order, zero-items failure, a fence-breaking message neutralized.
- `apps/imsg/server/today/build.test.ts`: fake port and gateway; exactly one gateway call with `claude-opus-5-5`; cap keeps every needsYou id in `openAtSnapshot`; gateway failure maps to copy.
- `apps/imsg/server/today/worker.test.ts`: single flight; a fenced-out claim skips; a thrown build posts failed. `trigger.test.ts`: done gives 0, failed gives 1, timeout gives 1, with an injected sleep.
- `client/src/lib/today.test.ts`: the placement table above row by row, plus fallback, held-done keeps its slot, and progress unchanged by a newer `snapshotAt`.
- `client/src/lib/inbox-model.test.ts`: the Today branch preserves rank order against pins and CRM priority, folded sections absent from navigation, search supersedes.
- `apps/imsg/e2e/fixture/convex-today.test.ts` and `today.playwright.ts`: opens on Today, settle leaves a gap and bumps progress, Regenerate shows Regenerating then folds New since into groups.

## Synthesis decision

Four candidates were sketched in parallel (Opus 5.5, GPT-6 Astra, Grok 4.6, and the orchestrator's own). All four kept the build off the outbox and ran it in a worker inside `comma:server`. This design (the Opus candidate) is the base.

- **Why this base.** It owns the least new state. Done, gaps, New since, Below the line and progress are all derived from live summaries plus `comma_triage_events`, which ingest already maintains. The `run`/`queue` split makes "the queue stays usable while regenerating" and "never yesterday's queue" structural.
- **Rejected from Astra.** A durable work-episode ledger fed by hooks in `upsertMessages`, `importOverlay` and conversation merges. It is more exact about reply-then-inbound history, but it spreads Today rules across every ingest writer. The triage log covers the mock's rules without new hooks.
- **Taken from Astra.** Today is fixed to Known contacts with no People chips or widening, and one real gateway call is a required verification step, since source reading cannot prove the gateway accepts `claude-opus-5-5` structured output at this input size.
- **Grok** converged on the same day-row shape with a single `presentToday` presenter. It confirms the base; nothing was grafted.
- **The orchestrator's candidate** kept one row per attempt and a carried `doneEarlier` counter. Both lost to the day row plus the derived clear log.
- **Fixed in synthesis.** The hub job id follows `references/jobs.md`: `mini.launchd.com.milad.imsg-today`.

## Tradeoffs accepted

- We accept one more table and four ingest routes in exchange for never touching the serial outbox, and for a Regenerate that is a plain authed mutation with no receipt to observe.
- We accept reusing the per-conversation `agentContext`/`agentPeople` routes, about 160 calls per build, in exchange for zero new message-reading code. The upgrade path is a batched route if build latency matters.
- We accept that "handled since build" relies on the Overlay's triage log, which records `reply` only when an open Needs you existed. A reply to a queued Waiting thread records nothing and correctly keeps it ranked.
- We accept that "N settled" counts every known conversation cleared today, not only queued ones, in exchange for a number that is pure derivation and survives any Regenerate.
- We accept that the day rolls at LA midnight, so 0:00 to 7:00 shows the fallback, in exchange for never showing yesterday's plan.
- We accept that a failed Regenerate over a good queue keeps that queue with an inline error rather than falling back. The mock's fallback rule is read as applying when today has no queue.
- We accept that the schema-unsupported retry inside `completeStructured` could, in a degenerate gateway state, make a second request, in exchange for not forking the gateway helper.
- `matchesFilters(chat, "today")` returning `false` looks like a bug and is not. Today is not a per-chat predicate.

## Alternatives considered

- **Regenerate as a global outbox kind.** A handler that awaits the build blocks every send for a minute. A handler that returns immediately makes its receipt meaningless and still needs the four global-kind registrations. The 7:00 AM job would need a second path anyway. This option exposes more surface for less capability.
- **Materialized per-item status.** Hooking `importOverlay`/`upsertConversations` to patch `done`, `newSince` and `settledCount` into the queue row. This syncs state the client already has live, spreads Today rules across ingest mutations, and makes Undo a second write path. It was rejected in favor of `classifyToday`.
- **Two build hosts.** A one-shot launchd process for 7:00 AM and the server for Regenerate, sharing `buildToday`. That gives an honest exit code but two lifecycles and a race only the fence resolves. The trigger-awaits-the-row design gets the honest exit code with one host.
- **Server-side ordering.** A Convex query that returns ordered, grouped conversation views. It duplicates the `listConversations` projection, breaks row identity with the directory, and puts the live rules in a query that cannot see client pending-flag intents.

## Implementation reconciliation

*Empty until Phase D.*

## Decisions on the runners' open questions

- A failed Regenerate over a good queue keeps that queue and shows the error inline. The fallback to Needs you order applies only when today has no queue.
- Today is fixed to Known contacts with no People chips.
- "N settled" counts every known conversation cleared since LA midnight.
- "M to go" is ranked plus New since. "Queue cleared" means no ranked rows remain; the header still names New since when it has rows.
- The Mini's system time zone is America/Los_Angeles (checked 2026-10-27), so `StartCalendarInterval` 07:00 and the LA day key agree.
- The building header says "Regenerating", with no thread count.

## Risks

- Does `TODAY_LIMITS.read = 120` threads at 30 clipped messages fit Opus 5.5 through the gateway within 300 seconds? The first real build answers it; lower `read` if not.
- Does the fixture expose its OverlayDb triage events to `convex.ts`? If not, add a small accessor.

## Next implementation step

Write `client/src/lib/today.ts` `classifyToday` and `planToday` against the placement table, with `today.test.ts` covering each row, since every surface (list, count, header, strip, fixture) reads through it.
