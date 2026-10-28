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
export const TODAY_LIMITS = {
  groups: 6, items: 50, messages: 30,
  needsYou: 150, recent: 100, recentMaxAgeMs: 30 * DAY_MS,   // the rotating read; see "Cards, rotation and settle"
  waiting: 50, waitingMaxAgeMs: 30 * DAY_MS,
} as const;
export const TODAY_SETTLE_GROUP = "settle";   // the reduce's reserved group; the client gives it Settle all

/** The LA calendar day containing `now` and its local midnight. Pure Intl; DST-correct. */
export function todayWindow(now: number): { day: DayKey; start: number } { throw new Error("not implemented"); }

/** Build-input rule: known, not spam, message-based. Needs you at any age; Waiting under 30 days. */
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

- `apps/imsg/shared/today.test.ts`: `todayWindow` across both DST transitions and at 23:59/00:00 LA; `todayCandidateState` at the 30-day boundary, for spam, for unknown, and for agent-only.
- `convex/comma/today.test.ts` (convex-test): `requestBuild` no-op while requested or building and attempt+1 after done or failed; `todaySchedule` requests only for a new day and is poll-safe; claim and finish are fenced by attempt and replay-safe; `expireRun` fails only a matching stuck run; `get` returns `cleared` since `dayStart`, latest per conversation, and drops an undone clear; unauthenticated `get`/`requestBuild` and a bad `bridgeKey` are rejected; `todayCandidates` pages and applies the rule.
- `apps/imsg/server/today/prompt.test.ts`: every drop rule, dense ranks in display order, zero-items failure, a fence-breaking message neutralized.
- `apps/imsg/server/today/build.test.ts`: fake port and gateway; exactly one gateway call with `claude-opus-5-5`; cap keeps every needsYou id in `openAtSnapshot`; gateway failure maps to copy.
- `apps/imsg/server/today/worker.test.ts`: single flight; a fenced-out claim skips; a thrown build posts failed. `trigger.test.ts`: done gives 0, failed gives 1, timeout gives 1, with an injected sleep.
- `client/src/lib/today.test.ts`: the placement table above row by row, plus fallback, held-done keeps its slot, and progress unchanged by a newer `snapshotAt`.
- `client/src/lib/inbox-model.test.ts`: the Today branch preserves rank order against pins and CRM priority, folded sections absent from navigation, search supersedes.
- `apps/imsg/e2e/fixture/convex-today.test.ts` and `today.playwright.ts`: opens on Today, settle leaves a gap and bumps progress, Regenerate shows Regenerating then folds New since into groups.

## Cards, rotation and settle

The first live build read only the newest 120 of 335 candidates and returned 23 items. The rule for v2 is that every day should make a dent toward inbox zero. So a build reads a bounded but rotating set, a cheap model cards each thread, and the Opus reduce works from the cards and aims for 50 items, with a group of threads that can simply be settled.

**Selection** (`selectToday` in `server/today/build.ts`, pure). A build reads up to 150 Needs you and 50 Waiting:

1. The newest Needs you under 30 days, up to 100.
2. The rest of the 150 from the remaining Needs you, least recently read first. A thread never read counts as oldest, and ties go newest first. Any recent overflow past 100 rotates the same way.
3. The newest 50 Waiting. Waiting now counts for 30 days instead of 7 (`todayCandidateState`).

`openAtSnapshot` is still every Needs you, so Below the line is unchanged. The queue also stores `candidateCount`, every candidate seen, so the header reads "read 194 of 335 threads". The field is optional; a queue stored before it existed falls back to its Needs you count.

**Read tracking.** The Overlay table `today_read (conversation_id, read_at)` records `claim.startedAt` for every read thread once a build succeeds. A failed reduce records nothing, so a failed day does not skip threads. Only the Today worker writes it.

**Cards** (`server/today/cards.ts`). One `claude-haiku-5-5` call per read thread, at low effort, a 60 s timeout and concurrency 12, through `Gateway.completeStructured`. Haiku 5.5 joins `THINKING_MODELS`, so its effort is forwarded. The card model reads the same thread block the reduce used to read: 30 messages with each text clipped to 400 characters, cleaned, with the CRM and notes lines. It returns a card:

```ts
{ summary: string;            // one sentence, clipped to 25 words
  ask: string | null;         // what they want from Milad
  due: string | null;         // a date or time they named
  stakes: "high" | "medium" | "low";
  settle: boolean;            // no reply owed: a thanks, a reaction, an FYI, a closed loop, spam
  needsMore: boolean }        // the window shown was not enough to judge
```

`parseCard` is the trust boundary. A card with no summary, unknown stakes, or that is not an object drops. Everything else clips: the summary to 25 words, ask to 160 characters, due to 60. An empty ask or due becomes null, and a non-boolean flag reads as false. The schema sends empty strings rather than nullable types, since nullable support in structured output is uncertain.

**Escalation.** A card with `needsMore` triggers one refetch at 150 messages (`agentContext` limit) and a 2,000-character clip, then one more card. That happens once per thread per build. If the wide card fails, the first card stands.

**Cache.** `today_card_cache` stores one row per conversation and window (30 or 150 messages). It holds the newest message's guid as the anchor, the card model and the card JSON. A build reuses a row whose anchor and model match and recomputes the rest. A new message or a model change invalidates the row. An escalated card is cached at its own window, so a cached build makes no call for it either.

**Failure.** A failed, unusable or timed-out card never fails the build. It is logged (`today: card c12 (<id>) at 30 messages failed, timeout: …`) and is not cached, and the reduce gets that thread's last 5 raw messages instead of 3. The card step also has a 120 s budget. After 120 s no new card call starts: cached cards still serve, and the rest fall back to raw messages. A slow card model therefore cannot use up the worker's 7 minutes.

**Reduce.** One `claude-opus-5-5` call, as before (medium effort, 16,000 max tokens, 300 s timeout). Each read thread gets one compact block: ref, state, age, unread, kind, the CRM and notes lines, the card fields (cleaned, since they are a model's reading of untrusted text), and the last 3 raw messages clipped to 300 characters. The system prompt:

- says the cards are a smaller model's summaries and the raw messages are ground truth;
- asks for about 50 items whenever the threads allow, and not to stop early;
- reserves the group id `settle`, titled "Just settle these" and placed last, for threads that owe no reply, each with a short reason such as "No reply needed: they said thanks";
- deliberately elevates threads older than 30 days that still deserve an answer, with the age in the reason;
- frames the brief as progress toward inbox zero;
- keeps 6 groups at most, counting `settle`.

`parseTodayOutput` treats `settle` like any other group. `renderTodayPrompt` takes an optional `lifeContext` and renders it under "What is going on in Milad's life:" when it is non-blank. Nothing fills it yet.

**Settle all.** In the Today list, the `settle` group's header has a Settle all button. `settleAllChats` settles every open row in the group through the same write as a single settle, `settleWrite` in `use-triage-actions.ts`. It then pushes one entry onto the shared undo stack, which unsettles all of them, and shows one "Settled N threads" toast with Undo. Single-row settle is unchanged.

**Measurement.** Each successful build logs one line:

```
today: build candidates needsYou=291 waiting=44 · read recent=88 rotated=62 waiting=44 · cards reused=0 computed=194 escalated=0 failed=0 ms=44667 · reduce in=57586 out=… ms=… · items=… settle=… deep=…
```

The reduce's input and output tokens come from the new optional `usage` on `completeStructured` results. Input counts cache reads and cache writes.

### Measured on the Mini (2026-10-27, read-only)

The measurement ran from `/tmp` with this branch's server code against the live Convex data and the loopback gateway. It used an in-memory Overlay, made no Opus call and wrote nothing. The deployed `todayCandidates` still applies the 7-day Waiting window, so the Waiting counts below are the 7-day numbers.

| | |
|---|---|
| Candidates | 335: 291 Needs you, 44 Waiting |
| Needs you by age | 52 under 7 days, 36 at 7 to 30, 116 at 30 to 90, 87 at 90 to 365 |
| Selection | 194 read: 88 recent, 62 rotated (all 30 to 90 days on a first run with no read history), 44 Waiting |
| Uncached card pass | 44.7 to 48.0 s wall for 194 threads over three runs (context fetch included), 0 failed |
| Card call latency | p50 2.4 to 2.5 s, p95 3.9 to 4.3 s, max 5.4 s |
| Escalation | 1 of 582 cards over three runs asked for more. Twenty forced 150-message cards all parsed, at 1.3 to 4.4 s |
| Cached card pass | 2.2 to 2.7 s, all 194 reused |
| Settle cards | 127 to 131 of 194 say no reply is owed; about 40 of them are Waiting. The reduce still decides from the raw messages |
| Reduce prompt | 57,586 to 58,374 input tokens by `count_tokens` (about 118,000 characters, plus a 3,748-character system prompt) |

**Deadlines.** The first live build took 40 s from snapshot to finish: 120 threads, an Opus reduce of roughly 35 s. Projected for v2: about 5 s of candidate reads, 45 to 48 s of cards and an estimated 40 to 90 s reduce over 58k tokens with about 50 items out. That comes to about 2 minutes uncached and about 1 to 1.5 minutes cached. The worker's 7-minute deadline, Convex's 8-minute building expiry, the trigger's 15 minutes and the hub wrapper's 1,200 s all hold in that order, so none was raised. The card budget (120 s, plus at most one 60 s call in flight) and the reduce timeout (300 s) can together exceed 7 minutes only when both are at their limits. The worker then fails the build with "The build timed out", as it did before.

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

Where the build differs from the shapes above, and why.

**Convex**
- `requestBuild` and `todaySchedule` reject a `dayStart` that is not `todayWindow(dayStart)`'s midnight for `day`. Cheap, and the client is the only caller that could get it wrong.
- `todayClaim` takes a `claimId` the worker generates per attempt, and the building run stores it. A claim with the same `claimId` on a building run of the same attempt gets the stored `startedAt` back, so an ingest retry after a lost response cannot fence out its own worker.
- `todayFinish` answers `true` to a replay of the outcome that already landed (done then ok, failed then not ok) and `false` to anything else, so the worker's ingest retries never log a false failure.
- Expiry errors are "The Mini didn't pick it up" (requested) and "The build timed out" (building). The header appends "at 7:00 AM".
- The CRM view moved into `validators.ts` as `conversationCrmView`; `listConversations` uses it unchanged.
- `convex/_generated/api.d.ts` was edited by hand in codegen's shape. `bunx convex codegen` needs a configured deployment, and deploying is the lead's step.

**Mini**
- One port type, `TodayPort.post<K>`, typed from the internal function refs (`TodayRoutes`), serves the worker, the build and the trigger instead of overloads plus a separate read port.
- `startTodayWorker` also returns `idle()` for tests.
- `startBridge` now creates the one `ConvexClient` itself (when `CONVEX_CLOUD_URL` is set) and hands it to both the outbox and the worker; the outbox still closes it on stop. The worker posts through a fresh `ConvexIngest`, which is stateless, because the injectable `ingest` dependency has no `request`.
- `buildToday` with no candidates writes an empty queue ("Nothing needs you right now.") without a model call.
- The gateway forwards `system` for every structured call, not only thinking models.
- The prompt neutralizes `<thread>` tags as well as the existing fence tags, puts notes per person, and lists events collected from the conversation's people.
- Attachment names and MIME types go through the same cleaning as message text, capped at 120 characters, since a file name is correspondent-controlled.
- The parser orders groups by their first accepted item, so rank 1 always heads the first group. `dropped` counts rejected items and items past 50.
- `awaitScheduledBuild` takes a `TodayPort`, keeps polling through a failed poll until the timeout, and measures the timeout against an absolute deadline from an injectable `now()`, checked before each poll, so time spent inside a slow poll counts.
- The worker races each build against a 7-minute deadline (injectable), under Convex's 8-minute building expiry. On timeout it posts `todayFinish` failed with "The build timed out" and keeps draining. The abandoned build's result is dropped, and a failed run rejects a later ok outcome anyway.

**Client**
- `classifyToday(view, chat)` and `planToday(view, chats, { held })` take no `now`; nothing in the table depends on it. `TodayPlan` adds `newSince`.
- `TodayHeader` carries no `dayStart`; the card takes the date from the view, else the provider's day. `failed` adds `failedAt` for "at 7:00 AM".
- Settled today lists conversations cleared today that carry no flag now; the settled count still counts every known conversation cleared today, per the decision below.
- `InboxRow` section `fold` is `{ key, open } | null`, because the toggle needs the section key.
- `use-today` is `use-today.ts` with `createElement`, as `use-ai.ts` is, since oxlint flags a `.tsx` that exports a hook. Regenerate calls `useConvex().mutation`, the agent pane's pattern; the fixture's `convex/react` has no `useMutation`.
- `stripCopy` keeps its object input; `today` is an optional field and `StripCopy` carries it.
- While building, the meta line reads "Reading threads with Opus 5.5…" and the brief dims. A failed Regenerate over a good queue adds a "Regenerate failed: …" line.
- The settings `openOn` parser was left alone; it is still stored-only.
- `planToday` takes `heldSection`, the section the list pane saw the held row in when the hold began. A held conversation from New since or Below the line that a reply would classify as settled or out stays in that section and never counts toward `toGo`. In fallback, `toGo` counts only open Needs you rows, not the held one.
- The workspace takes Today's membership, hold eligibility and advance order from the list's published rendered order (`useRenderedOrder`), so the fallback holds and advances too. `matchesFilters(…, "today")` still returns false.
- The advance target is recomputed whenever the rendered order changes, and folded rows are never in it, so folding Below the line re-aims auto-advance. The rendered-order store notifies only when the guid sequence changes, since the pane re-derives its rows on every parent render.
- Today, Needs you and Unread share one `ADVANCING` set in the workspace, so ⌘E on Today advances once with reply intent instead of a second preview selection.

**Fixture and ops**
- A fixture Regenerate stays `building` for 2.5 s, not 300 ms: the fixture client polls every 500 ms and would never show "Regenerating". It ranks into "Start here" and "Everything else".
- `todayMode` is a route, `POST /__fixture/today {"mode": "seeded" | "unbuilt" | "failed"}`, so a drive can switch the header mid-run.
- The plist runs `unset PROCID PROCID_REF PROCID_OFF` and the absolute bun path, as the other templates do. The installer bootstraps the calendar job without `kickstart` (a kickstart would build at install time) and checks it with `launchctl print`.

**v2: cards, rotation and settle**
- `todayQueue` gained an optional `candidateCount`; Milad approved the schema change. `convex/_generated/api.d.ts` was edited by hand in codegen's shape. Convex must deploy before the Mini code: until then `todayFinish` rejects the field, and the 30-day Waiting window needs the same deploy.
- `TODAY_LIMITS.read` is gone, replaced by `needsYou`, `recent`, `recentMaxAgeMs` and `waiting`. Context and cards run at concurrency 12, up from 8.
- `buildToday` takes a `store` (the Overlay's Today methods). `startBridge` passes its `OverlayDb`.
- The card schema uses empty strings for "none" instead of nullable types.
- The card step has a 120 s budget the brief did not ask for. It keeps a slow card model from consuming the worker deadline.
- `settleTriageChat` and the new `settleTriageChats` share one `settleWrite`. A single settle now reserves its undo token before checking the conversation's state, and an unused token is harmless.
- The header meta reads "read N of M threads" instead of "queued of read".
- The fixture seeds a "Just settle these" group (Taylor Morgan, Sofia Martinez) and `candidateCount: 21`. The auto-advance spec now lands on Taylor, who sits above Sofia.

**v2 review fixes**
- Each `todayItem` stores an optional `anchor`, the newest message guid the build read for that thread. `classifyToday` puts a settle-group item whose live newest guid differs, or that has no anchor, in New since. Settle all sends the stored anchor, so the bridge rejects a settle over a message the build never read.
- Settle all takes only rows that `settleAllTargets` finds ranked in `group:settle` and unchanged. A held, handled row still displays there but is never written.
- The Settle all toast's Undo calls `runUndo(token)` with the batch's own reserved token, so a settle committed while the batch ran is never the one reversed. ⌘Z keeps the global stack order.
- Settle all keeps the immediate pending flags but counts a row, and keeps its reversal, only once its command reaches a successful terminal receipt. Rejected rows roll back, are reported in the toast ("Settled 2 threads · 1 couldn't be settled"), and Undo leaves them alone. The toast waits for every outcome.
- `buildToday` returns `{ outcome, accept }`. The worker calls `accept`, which writes the rotation's read times, only after `todayFinish` returns true for that attempt. The worker passes each attempt an `AbortSignal` that the deadline and `stop()` abort. An aborted build throws at its next checkpoint, starts no new ingest read or model call, and writes no card or read time.
- The card budget is a time left, not an expired flag. It is checked again after the wide context read, before the Haiku call, and each card call's timeout is clamped to it. `StructuredOptions` gained an optional `signal` that the gateway combines with its timeout, so the build's cancellation aborts card and reduce calls in flight. `ConvexIngest.request` takes no signal, so the build checks the signal before each post instead.
- The card cache keys on `cardKey`, a hash of the model, the window and the rendered thread block, so an edit or retraction inside the window recomputes the card. The block is hashed with an empty `ref` and with `since` rendered against the thread's own last message, because the read order and the clock change every build and would otherwise defeat the cache. The Overlay column is `input_hash` in place of `anchor`; the table never shipped, so there is no migration. The wide window is now read before its cache check, since its content is the key.
- `renderTodayPrompt` caps the reduce prompt, system included, at `REDUCE_PROMPT_CHARS` (400,000). Over it, threads leave in the build's drop order (rotated Needs you, then Waiting, then recent Needs you, each oldest first) and the build logs how many. A dropped thread is not offered to the parser, not counted in `readCount`, and not marked read, so a dropped backlog thread stays first in the rotation.

**Not verified**
- No Opus reduce call was made on v2. Whether Opus fills about 50 items with a sensible settle group, and how long it takes over 58k tokens, is the first real v2 build's question.

## Decisions on the runners' open questions

- A failed Regenerate over a good queue keeps that queue and shows the error inline. The fallback to Needs you order applies only when today has no queue.
- Today is fixed to Known contacts with no People chips.
- "N settled" counts every known conversation cleared since LA midnight.
- "M to go" is ranked plus New since. "Queue cleared" means no ranked rows remain; the header still names New since when it has rows.
- The Mini's system time zone is America/Los_Angeles (checked 2026-10-27), so `StartCalendarInterval` 07:00 and the LA day key agree.
- The building header says "Regenerating", with no thread count.

## Risks

- Does the v2 reduce (58k tokens, about 50 items) finish inside 300 seconds? The first real v2 build answers it. The log line carries the reduce time.
- Haiku marks about two thirds of the read threads as settle. If the reduce trusts that too much, raw messages still let it overrule a card; watch the settle group's size in the log line.
- Does the fixture expose its OverlayDb triage events to `convex.ts`? If not, add a small accessor.

## Next implementation step

Write `client/src/lib/today.ts` `classifyToday` and `planToday` against the placement table, with `today.test.ts` covering each row, since every surface (list, count, header, strip, fixture) reads through it.

- **Overnight builds no longer cancel the morning build.** `todaySchedule` requests the 7:00 AM build when the day has no build or only one Milad ran before 7:00 AM. A run the schedule started never re-requests, so a failed morning build is not retried in a loop.
