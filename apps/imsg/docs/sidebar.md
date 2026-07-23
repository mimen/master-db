# Sidebar invariants

Normative rules for the Messages/Contacts sidebars. Sourced from the
architecture review (`sidebar-architecture-sol-review.md`, plan of record)
and the hard-won landmines behind it. A change that breaks one of these
needs a deliberate decision, not a drive-by edit.

## Module map

```
components/sidebar/            shared, passive
├── sidebar-frame.tsx          safe area + scroll-behind-chrome host + thumb seam
├── sidebar-chrome.tsx         the ONLY fixed chrome (58px glass bar) + action-button styles
├── sidebar-search-field.tsx   presentation-only field (list-header | chrome placements)
├── synthetic-scroll-thumb.tsx thumb overlay
├── suggestion-settings-button.tsx
└── use-synthetic-scroll-metrics.ts  SIDEBAR_CHROME_HEIGHT + thumb geometry; NEVER scrolls

components/conversations/      Messages-specific policy
├── use-conversation-search.ts     query + lens wipe + debounced deep search (wraps the
│                                  pure reducer in lib/conversation-search.ts)
├── use-conversation-list-viewport.ts  THE owner of FlashList imperative scrolling
└── use-conversation-list-keyboard.ts  glide adapter + list-search focus target

lib/inbox-model.ts             pure derivation: filters/search/navigationEntries
lib/conversation-search.ts     pure search reducer (query-tagged deep results)
```

Floating desktop cards and the pane split are screen-level layout
(`app/(tabs)/*.tsx`) — never sidebar internals.

## 1. Platform and module-graph rules

- Web sidebar lists use `keyboardDismissMode="none"`; native uses
  `"on-drag"`. RNW treats ANY scroll event (including programmatic
  scroll-to-top) as a drag and BLURS the focused input — this was the
  search focus-theft bug, root-caused via a Playwright `blur()` trap.
- Sidebar modules imported by native must touch no browser globals at
  module scope.
- The keyboard dispatcher is capture-phase (RNW TextInput stops keydown
  bubbling) and installed exactly once.
- E2E readiness never waits on `networkidle` — the SSE stream never
  settles. Wait on `/api/health` + semantic locators.

## 2. Desktop search-header rules

- Desktop search lives INSIDE the scrolling list header (explicit design:
  it rides the scroll). Mobile search lives in the fixed chrome. Both are
  the same `SidebarSearchField`.
- Query/filter changes must not replace the FlashList data-array identity
  wholesale or the header root type/key — the model reads one stable
  universe (`allChats`) and filters inside `deriveInboxModel`.
- No focus-repair logic in `onChangeText`; no timer-based `focus()`
  sequencing anywhere. Focus goes through the keyboard registry
  (`requestFocus("list-search")`, pending-focus for unmounted targets).

## 3. Search-state rules

- Search is a MODE: a nonblank query wipes both lenses to All (visibly)
  and spans the FULL universe — archived, unknown, DMs, groups.
- Blank-query browsing selects from `useChats`' FROZEN triage membership
  (`browseGuids`) — live filters are never reapplied on top, so rows don't
  vanish mid-triage.
- Deep (message-body) matches are tagged with the query that produced
  them; they apply ONLY while that tag equals the current normalized query
  (`lib/conversation-search.ts`). A query change clears them immediately.
- Badge selection clears search then applies the lens; ✕ and Esc clear
  only search on their first action. The two never compose.
- Contacts search is independent: no lenses, no deep search, own state.

## 4. Scroll and viewport rules

- ALL programmatic conversation-list scrolling lives in
  `use-conversation-list-viewport.ts`. No other module may call the
  FlashList's imperative scroll methods.
- A new lens/query view (`viewKey` change) starts at the top; a realtime
  reorder never yanks an already-scrolled web list to the top (recovery is
  keyed to the RENDERED list).
- Viewability = 100% visible. The viewable range is nullable and resets
  per view, so a stale range never suppresses a reveal.
- Glide edge-pinning: minimum scroll so the row sits flush at the edge
  being moved toward. Upward pins must clear the chrome (viewPosition
  fraction — FlashList ignores `viewOffset`). No recentering, ever.
- FlashList content height must never be driven by stateful
  `onContentSizeChange` loops (it echoes set frames — the composer
  oscillation family). Dimensions come from scroll events; plain FlatLists
  (Contacts) may use `onContentSizeChange` — theirs is reliable.
- `SIDEBAR_CHROME_HEIGHT` (58) is the only chrome-height source. Styled,
  not measured — runtime measurement once fed glide a stale value.

## 5. Keyboard rules

- Navigation order IS `InboxModel.navigationEntries` (rendered order:
  priority shelf, then list), each entry carrying a discriminated
  location. Never reconstruct `[...priority, ...listChats]` in handlers.
- Bare-letter commands never fire from editable targets (fail-closed
  editable check in the dispatcher).
- Glide moves PREVIEW (never mark read, never focus the composer); Enter
  activates (marks read + focuses composer). The preview callback is
  required — there is no open fallback.
- Removing the selected row advances to the next entry, else the previous
  (`neighborAfterRemoval`).
- Priority-shelf selections are revealed horizontally via
  `PriorityShelfHandle.reveal` (the shelf owns its own visibility).
- Keyboard code never touches list refs — it picks targets from the model
  and asks the owning viewport to reveal them.

## 6. Chrome and parity rules

- Both panes compose `SidebarFrame`/`SidebarChrome`/`SidebarSearchField` —
  parity is structural, not hand-maintained.
- The glass bar is the ONLY fixed chrome; content scrolls behind it.
- The Contacts filter icon is intentionally inert (bar parity) — kept by
  explicit decision.

## 7. Release gate

Every sidebar change passes before deploy:

```bash
cd apps/imsg
bun test
cd client && bunx tsc --noEmit && bun run build:web
cd .. && bunx tsc -b tsconfig.server.json
bun run e2e   # apps/imsg/e2e — live-app Playwright cases
```

Expo Go manual smoke for native-affecting changes: safe-area placement,
fixed mobile search, drag dismisses the keyboard, taps work with the
keyboard open, no chrome overlap, no DOM-only import failures.
