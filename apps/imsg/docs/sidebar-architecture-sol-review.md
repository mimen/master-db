## Verdict

Refactor the sidebar, but not with the proposed boundaries.

The right split is:

- **Shared structure:** frame, chrome, visual search field, synthetic scrollbar presentation.
- **Conversation-specific behavior:** inbox search semantics, FlashList viewport policy, keyboard navigation.
- **Contacts-specific behavior:** contact/Airtable search and FlatList.
- **Pure client model:** browse/search membership, ordering, navigation targets.

Do **not** merge scroll and keyboard. Do **not** build one generic `useSidebarSearch` for Messages and Contacts. Do **not** make `SidebarShell` own the desktop floating-card workspace.

A second-opinion escalation independently confirmed the principal correctness finding below.

---

# Severity-ranked findings

## HIGH — The “stable allChats source” workaround currently breaks frozen triage views

`useChats` deliberately freezes active-filter membership so reading or replying does not evict a row during a triage pass:

- `client/src/hooks/use-chats.ts:51-75`

But the pane ignores that frozen `chats` result and always derives from `allChats`:

- `client/src/components/conversation-list-pane.tsx:141`
- `client/src/lib/inbox-model.ts:108-112`

Concrete flow:

1. Enter Unread.
2. Open an unread conversation.
3. `openChat` clears its unread flag at `client/src/app/(tabs)/index.tsx:142-149`.
4. `allChats` updates.
5. `deriveInboxModel` applies live `matchesFilters`.
6. The row disappears, defeating the frozen-triage contract.

The draft currently celebrates this as the stable-source solution:

- `docs/sidebar-architecture-draft.md:30-31`
- `docs/sidebar-architecture-draft.md:53-54`

That must be corrected before extracting it into an architecture. The later Playwright investigation established `keyboardDismissMode` as the focus-theft root cause. “Changing data array identity remounts the header” should not become an invariant without an isolated reproduction; list data necessarily receives new array identities during normal updates.

### Correction

Keep one universe if desired, but pass the exact frozen browse membership explicitly:

```ts
export interface InboxModelInput {
  readonly universe: readonly ChatSummary[];
  readonly browseGuids: ReadonlySet<string>;
  readonly filters: InboxFilters;
  readonly query: string;
  readonly deepSearch: DeepSearchState;
}

export function deriveInboxModel(input: InboxModelInput): InboxModel;
```

Rules:

- Blank query: select from `universe` using `browseGuids`. Do not reapply live filters and discard the frozen membership.
- Active query: search the full `universe`, ignoring `browseGuids`.
- `filters` still provide labels, priority eligibility, and mode metadata.

This preserves the current temporal policy owned by `useChats` while keeping presentation derivation pure and testable.

---

## MEDIUM — Deep-search results are attributed to the wrong query while the next request is pending

At `conversation-list-pane.tsx:220-239`, `deepMatches` is only cleared when the query becomes shorter than two characters.

If results for `pizza` have landed and the user changes the query to `zebra`, the old `pizza` GUID set continues contributing matches until the `zebra` request resolves. The cancellation guard prevents an old request from landing late, but it does not prevent already-landed results from being reused with a new query.

`inbox-model.ts:96-107` has no way to know which query produced the set.

### Correction

Tag asynchronous matches with their normalized query:

```ts
export type DeepSearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly query: string }
  | {
      readonly kind: "ready";
      readonly query: string;
      readonly guids: ReadonlySet<string>;
    }
  | { readonly kind: "failed"; readonly query: string };
```

`deriveInboxModel` may consume the GUIDs only when:

```ts
deepSearch.kind === "ready" &&
deepSearch.query === normalizedQuery
```

The pure reducer should clear usable matches immediately when the normalized query changes.

---

## MEDIUM — `ensureRowVisible(index, direction)` cannot represent the actual rendered navigation space

The rendered keyboard order includes the horizontal priority shelf followed by FlashList rows:

- `conversation-list-pane.tsx:145-188`
- `shared/chat-state.ts:108-122`

The shelf can contain ten conversations, while the sidebar is 380px wide:

- `priority-shelf.tsx:33-73`
- `client/src/app/(tabs)/index.tsx:394-398`

Current keyboard handling only scrolls vertically to the header for priority targets:

- `conversation-list-pane.tsx:168-171`

It never reveals an offscreen horizontal shelf item. Gliding to priority item five or later can therefore leave the keyboard selection invisible.

A single numeric index also does not distinguish a priority index from a FlashList row index.

### Correction

Make navigation locations explicit:

```ts
export type InboxNavigationLocation =
  | {
      readonly kind: "priority";
      readonly index: number;
    }
  | {
      readonly kind: "list";
      readonly index: number;
    };

export interface InboxNavigationEntry {
  readonly chat: ChatSummary;
  readonly location: InboxNavigationLocation;
}
```

Have `InboxModel` expose `navigationEntries` in rendered order. Do not repeatedly reconstruct `[...priority, ...listChats]` and search both arrays in event handlers.

Ownership:

- The vertical FlashList viewport owns vertical visibility and its `viewableRange`.
- `PriorityShelf` owns horizontal visibility and exposes a narrow imperative handle.
- The keyboard adapter chooses the target and asks the appropriate viewport to reveal it.

```ts
export interface PriorityShelfHandle {
  reveal(index: number, direction: -1 | 1): void;
}
```

---

## MEDIUM — The proposed `useSidebarScroll` is too broad

The draft places all of these in one reusable hook:

- synthetic indicator geometry;
- FlashList viewability;
- keyboard edge-pinning;
- web reorder restoration;
- imperative scrolling;
- FlatList support.

Those are not one abstraction.

`contacts-list-pane.tsx` needs passive metrics for a synthetic thumb. It does not need FlashList viewability, reorder recovery, or keyboard edge-pinning. A generic hook would become a list-type switchboard full of optional capabilities.

### Correction

Split passive shared mechanics from conversation-specific viewport policy:

```text
client/src/components/sidebar/
├── sidebar-frame.tsx
├── sidebar-chrome.tsx
├── sidebar-search-field.tsx
├── synthetic-scroll-thumb.tsx
├── use-synthetic-scroll-metrics.ts
└── suggestion-settings-button.tsx

client/src/components/conversations/
├── conversation-list-header.tsx
├── use-conversation-search.ts
├── use-conversation-list-viewport.ts
└── use-conversation-list-keyboard.ts
```

`useSyntheticScrollMetrics` is reusable. It observes offset/content/viewport dimensions and produces thumb geometry; it never scrolls.

`useConversationListViewport` is FlashList-specific and owns:

- the FlashList ref;
- nullable fully-visible range;
- vertical edge-pinning;
- scroll-to-top;
- web reorder restoration;
- top-overlay clearance;
- FlashList-specific event handling.

This is the right API shape:

```ts
export interface ConversationListViewport {
  readonly listRef: React.RefObject<FlashListRef<ChatSummary> | null>;
  readonly thumb: SyntheticThumbState | null;

  scrollToTop(): void;
  scrollToHeader(): void;
  revealListRow(index: number, direction: -1 | 1): void;
}

export function useConversationListViewport(args: {
  readonly renderedChats: readonly ChatSummary[];
  readonly estimatedContentHeight: number;
  readonly chromeHeight: number;
}): ConversationListViewport;
```

All programmatic vertical scrolling should live in this module. “Nothing else may scroll” is too broad; the enforceable rule is “no other module may call the conversation FlashList’s imperative scrolling methods.”

---

## MEDIUM — `useSidebarSearch` incorrectly suggests Messages and Contacts share search behavior

Messages search has:

- full-universe search;
- lens reset;
- deep message search;
- Esc-ladder participation;
- view-reset semantics.

Contacts search has:

- local name filtering;
- debounced Airtable lookup;
- add/link state;
- no inbox lenses;
- no current list keyboard adapter.

See:

- `conversation-list-pane.tsx:132-141,218-247,281-319`
- `contacts-list-pane.tsx:109-134`
- `client/src/hooks/use-airtable-search.ts:22-75`

Sharing the visual field is correct. Sharing the state hook is not.

Also, a React hook containing debounce/API effects is not a “pure state machine.” Extract a pure reducer and wrap it in a side-effectful conversation hook.

```ts
export interface ConversationSearchController {
  readonly query: string;
  readonly normalizedQuery: string;
  readonly active: boolean;
  readonly deepSearch: DeepSearchState;
  readonly viewKey: string;
  readonly inputRef: React.RefObject<TextInput | null>;

  setQuery(value: string): void;
  clear(): boolean;
  applyFilters(filters: InboxFilters): void;
}

export function useConversationSearch(args: {
  readonly filters: InboxFilters;
  readonly onFiltersChange: (filters: InboxFilters) => void;
}): ConversationSearchController;
```

The hook should not scroll. The pane observes `viewKey` and tells the viewport to scroll to the top. That keeps search policy from importing list mechanics.

Contacts should retain its own query state and `useAirtableSearch`.

---

## MEDIUM — The current keyboard adapter captures stale chrome geometry

The adapter effect runs only when `wide` changes:

- `conversation-list-pane.tsx:152-216`

It reads `topBarH` directly at line 179, unlike the other mutable values routed through refs. The initial state is `48` at line 74, but the actual styled height is `58` at lines 501-513 and is measured later at lines 443-446.

On an initial desktop render, upward edge-pinning can permanently use the stale 48px value and place a row partly under the glass bar.

The refactor should eliminate this rather than copy the ref-mirroring pattern.

The chrome has a fixed 58px style in both panes. Define one constant and remove measurement state:

```ts
export const SIDEBAR_CHROME_HEIGHT = 58;
```

If the chrome later becomes intrinsically sized, introduce measured layout as a deliberate change. Do not retain runtime measurement for a currently fixed dimension.

---

## LOW — `SidebarShell` should not own the floating-card workspace

The draft includes the “floating cards seam” in `SidebarShell`:

- `docs/sidebar-architecture-draft.md:63-65`

The floating cards and multi-pane desktop composition are screen-level layout:

- `client/src/app/(tabs)/index.tsx:275-279,376-407`
- `client/src/app/(tabs)/contacts.tsx:31-54,58-83`

The sidebar frame should own only the left pane’s safe area, fixed chrome, scroll-body host, and thumb overlay.

If the desktop split/card duplication is extracted later, make it a separate `DesktopWorkspaceFrame`. Do not couple thread/person pane layout to sidebar chrome.

---

# Recommended factoring

## Shared sidebar structure

```ts
export interface SidebarFrameProps {
  readonly chrome: React.ReactNode;
  readonly thumb?: React.ReactNode;
  readonly children: React.ReactNode;
}

export function SidebarFrame(props: SidebarFrameProps): React.JSX.Element;
```

Use a normal component with named slots. No general render-prop abstraction is needed while chrome height is fixed.

```ts
export interface SidebarChromeProps {
  readonly active: "messages" | "contacts";
  readonly leading: React.ReactNode;
  readonly actions: React.ReactNode;
}

export function SidebarChrome(props: SidebarChromeProps): React.JSX.Element;
```

Behavior stays outside:

- Desktop `leading`: `NavSwitcher`.
- Mobile `leading`: that pane’s search field.
- Desktop search remains in the scrolling list header exactly as required.

The shared field is presentation-only:

```ts
export interface SidebarSearchFieldProps {
  readonly value: string;
  readonly accessibilityLabel: string;
  readonly placement: "list-header" | "chrome";
  readonly inputRef?: React.Ref<TextInput>;
  readonly onChangeText: (value: string) => void;
  readonly onClear: () => void;
}

export function SidebarSearchField(
  props: SidebarSearchFieldProps,
): React.JSX.Element;
```

## Passive synthetic scrollbar

```ts
export interface SyntheticThumbState {
  readonly visible: boolean;
  readonly top: number;
  readonly height: number;
  readonly translateY: Animated.AnimatedInterpolation<number>;
}

export interface SyntheticScrollMetrics {
  readonly thumb: SyntheticThumbState;
  onViewportHeight(height: number): void;
  onContentHeight(height: number): void;
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void;
}

export function useSyntheticScrollMetrics(args: {
  readonly chromeHeight: number;
  readonly estimatedContentHeight: number;
}): SyntheticScrollMetrics;
```

FlashList supplies content metrics from scroll events. FlatList may additionally report `onContentSizeChange`. That difference belongs at the composition call site, not behind a broad `"flash-list" | "flat-list"` policy switch.

## Conversation keyboard adapter

```ts
export type UseConversationListKeyboardArgs =
  | {
      readonly enabled: false;
    }
  | {
      readonly enabled: true;
      readonly entries: readonly InboxNavigationEntry[];
      readonly selectedGuid?: string;
      readonly onPreview: (chat: ChatSummary) => void;
      readonly onActivate: (chat: ChatSummary) => void;
      readonly viewport: ConversationListViewport;
      readonly priorityShelfRef:
        React.RefObject<PriorityShelfHandle | null>;
      readonly search: Pick<
        ConversationSearchController,
        "clear" | "inputRef"
      >;
    };

export function useConversationListKeyboard(
  args: UseConversationListKeyboardArgs,
): void;
```

Important rules:

- `onPreview` is required when keyboard navigation is enabled.
- Do not fall back to `onOpenChat`; that can mark a chat read and focus the composer while gliding.
- `viewableRange` is not exposed.
- Pure helpers resolve next/previous and post-removal neighbor targets.
- The adapter previews first, then reveals based on the entry’s location.
- Focusing search calls `viewport.scrollToHeader()` and uses the existing pending-focus registry rather than a 30ms timer.

---

# Direct answers to the five open questions

## 1. Should scroll and keyboard merge? Where does `viewableRange` live?

No merge.

Keyboard owns **selection intent and rendered order**. The viewport owns **physical visibility**.

`viewableRange` is private to `useConversationListViewport`. Initialize it as `null`, not `{ first: 0, last: 0 }`, and reset it whenever the rendered view changes. An empty viewability callback must clear it rather than leave a stale prior range.

Vertical edge-pinning lives in the FlashList viewport. Horizontal edge-pinning lives in `PriorityShelf`. The keyboard adapter only dispatches based on the target’s discriminated location.

Reorder preservation also belongs in the FlashList viewport, keyed to `model.listChats`, not the unrelated `chats` prop currently used at `conversation-list-pane.tsx:249-262`.

## 2. Shell component or render props? Move Contacts to FlashList?

Use a component with explicit named slots. Do not use a general render prop.

Because chrome height is fixed, the frame does not need to inject layout measurements into arbitrary children. Both panes can import `SIDEBAR_CHROME_HEIGHT`.

Do not move Contacts to FlashList in this refactor. Structural parity does not require identical virtualization primitives. Migrating would expose Contacts to FlashList-specific header and viewability behavior with no demonstrated performance need.

Keep FlatList and share only:

- frame;
- chrome;
- search-field rendering;
- suggestion-settings button;
- passive thumb metrics.

## 3. How should desktop search inside `ListHeader` be hardened?

First, revise the premise: “one stable data source” is not itself the safety rule and currently causes a correctness regression.

Enforce these instead:

1. Desktop search remains inside `ListHeaderComponent`.
2. The FlashList component is never keyed by query, filters, loading, or mode.
3. The header root and search field retain stable React types and keys.
4. Use a hoisted `ConversationListHeader`, not a component function declared during render.
5. `keyboardDismissMode` is always `"none"` on web and `"on-drag"` on native.
6. Programmatic scrolling must not be followed by focus-repair inside `onChangeText`.
7. Register the search input as a focus target so scrolling an unmounted/virtualized header can request pending focus.
8. Deep matches are tagged with the query that produced them.
9. Browse-mode membership must continue using the frozen triage membership.
10. A checked-in Playwright test must assert that typing a shortcut-bearing string does not lose focus or invoke list commands.

Do not put the search field in fixed desktop chrome.

## 4. One refactor PR or sliced? Should the Playwright repro be checked in?

Slice it. This is too coupled for one refactor PR.

I found no tracked `scratchpad/repro-search.mjs` or Playwright harness in this worktree. Convert the repro into a checked-in test; do not merely preserve a scratch script.

Put Playwright outside `client/src`, preferably under:

```text
apps/imsg/e2e/
├── playwright.config.ts
├── fixtures/
└── sidebar.spec.ts
```

Keep the dependency at the `apps/imsg` package level so nothing enters the Expo native module graph.

Never use `networkidle`; SSE intentionally prevents it from settling. Wait for the API health endpoint and semantic UI locators.

## 5. What belongs in `shared/`?

Keep `inbox-model.ts` client-only.

`shared/` should retain domain rules consumed by both server and client:

- chat flags;
- state/type matching;
- priority-shelf eligibility;
- message-state transitions;
- shared wire/domain types.

These remain appropriate in `shared/chat-state.ts`.

The following are client presentation or interaction policies and should not move:

- section labels;
- search-mode supersession;
- frozen session membership;
- pinned display ordering;
- navigation locations;
- keyboard selection;
- viewport state;
- chrome and scrollbar behavior.

Promote code to `shared/` only when a real server consumer appears.

---

# Sidebar invariants document outline

Create `docs/sidebar.md` with rules phrased normatively, not as historical anecdotes.

## 1. Platform and module-graph rules

| Invariant | Enforcement |
|---|---|
| Web sidebar lists use `keyboardDismissMode="none"`; native uses `"on-drag"` | Static contract test + Playwright + Expo Go manual |
| Sidebar modules imported by native touch no browser globals at module scope | Lint/static check + native bundle smoke |
| Keyboard dispatcher is capture-phase and installed once | Static test + Playwright |
| E2E readiness never waits for `networkidle` because SSE remains open | Static test over E2E sources |

A source-scanning contract test is more realistic than an Oxlint customization for the first and fourth rules.

## 2. Desktop search-header rules

| Invariant | Enforcement |
|---|---|
| Desktop search is inside the scrolling list header | Playwright geometry test |
| Mobile search is inside fixed chrome | Responsive Playwright + Expo Go |
| Query/filter changes do not replace the FlashList or header root type/key | Component review + Playwright focus test |
| Search `onChangeText` never contains focus-repair logic | Static source test |
| No timer-based `focus()` sequencing | Static source test |
| Programmatic scroll events never blur the web search input | Playwright |

The geometry test should verify that the desktop search field moves upward and out of view while the chrome’s bounding box remains fixed.

## 3. Search-state rules

| Invariant | Enforcement |
|---|---|
| Entering nonblank Messages search resets both lenses to All | Reducer unit test + Playwright |
| Search spans the full universe, including archived conversations | Model unit test |
| Blank-query browsing uses frozen triage membership | Model/hook unit test + Playwright |
| Badge selection clears search and applies the selected lens | Reducer unit test + Playwright |
| Clear button and Esc clear only search on their first action | Unit + Playwright |
| Deep matches apply only to the normalized query that produced them | Fake-timer unit test + delayed-response Playwright |
| Contacts search remains independent of inbox lenses | Unit/component test |

## 4. Scroll and viewport rules

| Invariant | Enforcement |
|---|---|
| All programmatic conversation-list `scrollToOffset`/`scrollToIndex` calls live in the viewport module | Static source test |
| A new lens/query view begins at the top | Playwright |
| Realtime reorder does not reset an already-scrolled list | Playwright |
| Viewability means 100% visible, not partially visible | Unit/config assertion |
| Viewable range is nullable and resets when the rendered view changes | Unit test |
| Upward pinning leaves the selected row completely below chrome | Playwright bounding-box assertion |
| Downward pinning leaves the selected row completely inside the viewport | Playwright |
| Priority-shelf selection is horizontally revealed | Playwright |
| FlashList code does not use `viewOffset` | Static source test |
| FlashList content height is not driven by stateful `onContentSizeChange` loops | Static source test |

## 5. Keyboard rules

| Invariant | Enforcement |
|---|---|
| Navigation order equals `InboxModel.navigationEntries` | Model unit test |
| Bare-letter commands never fire from editable targets | Existing keyboard unit test + Playwright |
| Preview navigation never marks read or focuses the composer | Playwright |
| Activating with Enter does mark read and focus the composer | Playwright |
| Removing the selected row chooses next, else previous | Pure helper unit test |
| Keyboard-enabled pane requires an explicit preview callback | Type system |
| Every navigation entry has a priority or list location | Type system |

## 6. Chrome and parity rules

| Invariant | Enforcement |
|---|---|
| Chrome height has one source of truth | Static import/source test |
| Messages and Contacts use the same frame/chrome/search-field components | Component test/static source test |
| Chrome displays only available actions; no inert parity controls | Component/accessibility test |
| Floating workspace cards are not owned by sidebar internals | Architecture boundary/code review |

## 7. Native release gate

Automated:

- tests;
- client TypeScript;
- server TypeScript;
- web export;
- native bundle/module-graph smoke.

Expo Go manual:

- Messages and Contacts safe-area placement;
- mobile search remains fixed;
- drag dismisses the native keyboard;
- tapping list results while the keyboard is open works;
- search clear works;
- list content is not hidden under chrome;
- switching tabs does not retain inappropriate focus;
- no DOM-only module import failure.

---

# Sliced implementation sequence

Every slice should pass:

```bash
cd /Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg
bun test
cd client && bunx tsc --noEmit
cd .. && bunx tsc -b tsconfig.server.json
cd client && bun run build:web
```

## Slice 0 — Lock the current behaviors and fix the two correctness regressions

Changes:

- Check in Playwright infrastructure and the exact focus-theft repro.
- Restore frozen triage membership in `deriveInboxModel`.
- Query-tag deep search results.
- Document invariants.

Regression checks:

- Typing into search keeps focus after a programmatic scroll event.
- Unread row remains after opening it.
- Delayed old deep-search results never appear under a new query.
- Existing inbox-model and keyboard tests remain green.
- Expo Go smoke after the model signature change.

These correctness changes should be separate commits from extraction so they remain bisectable.

## Slice 1 — Make the rendered/navigation model explicit

Changes:

- Add `browseGuids`.
- Add `navigationEntries`.
- Add pure next/previous/neighbor helpers.
- Remove repeated priority/list concatenation from event handlers.
- Make public model fields minimal.

Regression checks:

- Priority then list ordering.
- Pinned ordering.
- Every navigation entry has the correct location and index.
- Next/previous clamps correctly.
- Post-removal neighbor chooses next, then previous.
- Search/full-universe and frozen-browse tests.

## Slice 2 — Extract Messages search

Changes:

- Pure search reducer.
- `useConversationSearch`.
- Shared visual `SidebarSearchField`.
- Register `list-search` with the focus-target registry.
- Remove the 30ms focus timer.
- Keep Contacts on its existing independent state.

Regression checks:

- First nonblank input resets lenses exactly once.
- Button/Esc/badge clear paths.
- Active element remains the input while typing.
- Type a string containing `j`, `k`, `e`, `u`, `c`, and `z`; assert the entire value appears and no command executes.
- Deep result landing does not remount or blur the field.

## Slice 3 — Extract passive metrics and the FlashList viewport

Changes:

- `SIDEBAR_CHROME_HEIGHT`.
- `useSyntheticScrollMetrics`.
- `useConversationListViewport`.
- Private nullable viewable range.
- Move all vertical imperative scrolling and reorder recovery.
- Key reorder recovery to the rendered list.

Regression checks:

- Lens/query reset to top.
- Realtime update preserves scroll offset.
- Thumb visibility and geometry at top, middle, and bottom.
- Glide up clears chrome completely.
- Glide down remains fully visible.
- No web input blur during any programmatic scroll.
- Native drag still dismisses the keyboard.

## Slice 4 — Extract keyboard/list integration and priority-shelf reveal

Changes:

- `useConversationListKeyboard`.
- Required preview callback.
- Discriminated navigation locations.
- `PriorityShelfHandle.reveal`.
- Remove direct viewport/ref access from keyboard code.

Regression checks:

- Navigation follows priority shelf, then list.
- Shelf item six or later scrolls horizontally into view.
- Preview does not mark read.
- Enter activates and focuses composer.
- Archive/unarchive advances to the correct neighbor.
- Esc ordering remains search clear, then list mode, then pane closure.

## Slice 5 — Extract shared frame and chrome; migrate Messages

Changes:

- `SidebarFrame`.
- `SidebarChrome`.
- `SuggestionSettingsButton`.
- Shared glass/chrome/action styles.
- Keep desktop search in `ConversationListHeader`.
- Leave desktop split cards at screen level.

Regression checks:

- Chrome bounding box remains fixed while search scrolls.
- Popover anchors remain under their buttons.
- Wide and mobile layout screenshots.
- Messages safe-area and content inset in Expo Go.

## Slice 6 — Migrate Contacts and remove duplication

Changes:

- Adopt frame, chrome, search field, suggestion button, thumb metrics.
- Retain FlatList.
- Delete inert/dead code listed below.

Regression checks:

- Contacts desktop search rides the scroll.
- Contacts mobile search stays in chrome.
- Web scrolling does not blur Contacts search.
- Native dragging dismisses the Contacts keyboard.
- Airtable results/add flow remains intact.
- Messages chrome is unaffected.

---

# Checked-in Playwright cases

The original repro should become the first case, not a standalone debugging script.

1. **Search focus under programmatic scroll**
   - Start at nonzero sidebar offset.
   - Enter list mode and press `/`.
   - Confirm the header scrolls to the top.
   - Type a string containing list command letters.
   - Assert exact input value, focused element, unchanged selected row, and no archive/unread actions.

2. **Desktop search is scrolling content**
   - Record chrome and search bounding boxes.
   - Scroll.
   - Assert chrome Y is unchanged and search Y moves out of view.

3. **Web scroll never dismisses search**
   - Focus Messages search.
   - Trigger query-reset scroll and wheel scroll.
   - Assert focus remains.
   - Repeat for Contacts.

4. **Search/lens state machine**
   - Enter a non-All lens.
   - Type search and assert lenses become All.
   - Clear with ×.
   - Search again and select a badge; assert search clears and badge applies.
   - Search again and press Esc; assert only search clears.

5. **Deep-search race**
   - Delay two intercepted responses.
   - Resolve the first query, change the query, keep the second pending.
   - Assert first-query-only chats disappear immediately.
   - Resolve the second and assert only its results appear.

6. **Frozen triage membership**
   - Open Unread.
   - Select an unread chat.
   - Assert the row remains while its unread presentation updates.

7. **Realtime reorder preservation**
   - Scroll to a known row.
   - Inject or mock a new top conversation.
   - Assert the viewport does not jump to zero.

8. **Vertical edge-pinning**
   - Glide down past the viewport and assert the selected row bottom is visible.
   - Glide upward and assert the row top is below the chrome bottom.

9. **Horizontal priority reveal**
   - Seed at least six priority conversations.
   - Glide across them.
   - Assert each selected shelf item intersects the visible shelf viewport.

The harness must wait on explicit health/UI readiness, never network idle.

---

# Delete outright

1. **The inert Contacts filter icon**

   `contacts-list-pane.tsx:282-285`

   It advertises a capability that does not exist and consumes action space solely for visual parity. Structural parity does not require fake controls.

2. **Runtime chrome-height measurement**

   - `conversation-list-pane.tsx:74,445`
   - `contacts-list-pane.tsx:69,268`

   Both bars are explicitly styled to 58px. Replace state and `onLayout` with one constant.

3. **The 30ms search-focus timer**

   `conversation-list-pane.tsx:196-199`

   Use the pending-focus registry. Timing guesses are exactly the kind of cross-behavior coupling this refactor is meant to remove.

4. **Unsafe optional preview fallback**

   - `conversation-list-pane.tsx:44-45`
   - `conversation-list-pane.tsx:162,213`

   Keyboard preview must never silently fall back to reply/open behavior. Make it required whenever keyboard navigation is enabled.

5. **Transitional `clearSearch?` optionality**

   `client/src/lib/keyboard/types.ts:77-80`

   The comment explicitly says it is optional only to avoid breaking in-flight work. The final adapter contract should require it.

6. **Dead styles**

   - `conversation-list-pane.tsx:520-525` — `title`
   - `conversation-list-pane.tsx:587-590` — `separator`
   - `conversation-list-pane.tsx:497-500` — `paneWide` duplicates `pane.flex`
   - `contacts-list-pane.tsx:342-347` — `title`

7. **Unused public `InboxModel` surface**

   `searchedChats` and `recent` are not consumed by the UI. Keep them as local derivation variables unless a real caller needs them.

8. **The “data array identity remount” landmine as written**

   Replace it with enforceable header/list identity rules. Do not encode the disproved diagnosis as architecture.

9. **The floating-card seam from `SidebarShell` scope**

   Sidebar internals should not own thread/person workspace composition.

Do **not** delete the synthetic scrollbar or migrate Contacts to FlashList in this refactor. Those would be product/performance changes, not removal of accidental complexity.
