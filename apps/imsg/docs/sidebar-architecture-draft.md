# Sidebar architecture review — draft inventory (Fable)

Status: SUPERSEDED — Sol's review (sidebar-architecture-sol-review.md) is the plan of record; his slices 0-6 + invariants govern. Slice 0 landed 2026-07-23. Goal: refactor the sidebar into a sustainable,
well-understood factoring. Triggered by the on-drag/scroll-to-top focus-theft
bug (root-caused 2026-07-23) and the pattern of interacting behaviors breaking
each other.

## What the sidebar currently does (behavior inventory)

`conversation-list-pane.tsx` (~450 lines) owns ALL of:

**Scrolling (5 interacting policies)**
1. Synthetic scrollbar: Animated scrollY + content/viewport tracking sourced
   from scroll events (FlashList virtualizes, onContentSizeChange unreliable),
   row-count estimate pre-first-scroll, thumb below glass bar.
2. Scroll-to-top on lens/query change (a "new view" resets position).
3. Realtime-reorder preservation (incoming message must not yank position).
4. Glide edge-pinning: viewableRange (fully-visible only) + scrollToIndex,
   viewPosition 1 downward / fraction-of-viewport upward (viewOffset ignored
   by FlashList).
5. maintainVisibleContentPosition (FlashList) + keyboardDismissMode
   (NATIVE-ONLY — RNW blurs focused inputs on any scroll event; see bug).

**Search/filter state machine**
- query local state; searching wipes lenses to All (visible reset).
- Badge click exits search + applies badge; ✕ clears; Esc-ladder clears via
  adapter.clearSearch (first rung).
- Deep search: 250ms debounce → api.search → deepMatches Set (async lands
  mid-typing — was implicated in earlier remount theories).
- Model reads ONE stable source (allChats) — lens filtering inside
  deriveInboxModel; swapping arrays remounts FlashList internals.

**Keyboard integration**
- ListAdapter registered with controller: move/activate/focusSearch/
  clearSearch/selectNeighborOf; rendered-order navigation (priority shelf +
  filtered list); archive-advances-cursor.
- Glide cursor rendering (keyboardFocused prop → accent bar on row).
- viewabilityConfig 100% + viewableRange ref.

**Chrome**
- Frosted glass fixed top bar (58px): NavSwitcher (wide) / inline search
  (mobile) + AI popover + filter popover + compose. measureInWindow anchoring.
- Desktop search rides the scroll in ListHeader (Milad's explicit design);
  mobile search pinned in bar.

**Duplication**
- contacts-list-pane.tsx re-implements: glass bar, icons row, synthetic
  scrollbar, search field, offsets. Parity maintained BY HAND — every sidebar
  change must be made twice (proven drift: scrollbar/offset/placeholder bugs).

## Known landmines (hard-won, currently documented only in commit messages)
- RNW keyboardDismissMode="on-drag" blurs inputs on ANY web scroll event.
- FlashList: header remounts when the data array identity swaps wholesale;
  onContentSizeChange echoes set frames (composer bug family); viewOffset
  ignored; networkidle never settles (SSE) for tooling.
- Capture-phase keydown required (RNW TextInput stops bubbling).
- macOS text-system bindings eat plain chords (⌘E) in text fields.
- Focus: composer autofocus via focus-target registry; Esc-ladder blur.

## Proposed factoring (v1 — for Sol to attack)

```
client/src/components/sidebar/
├── SidebarShell.tsx      # glass chrome + icon slots + (wide) toggle/(mobile)
│                         # search slot + floating cards seam; used by BOTH tabs
├── useSidebarScroll.ts   # THE scroll owner: ref, synthetic thumb geometry,
│                         # scrollToTop(), ensureRowVisible(index, direction),
│                         # reorder preservation; nothing else may scroll
├── useSidebarSearch.ts   # query + lens-wipe + deep search + clear paths;
│                         # pure state machine, unit-tested
├── useListKeyboard.ts    # adapter registration from the rendered model
└── docs: invariants section in docs/sidebar.md (landmines above)
```

- messages/contacts panes become thin compositions: Shell + their list + their
  row renderers. Parity becomes structural, not manual.
- Every scroll mutation goes through useSidebarScroll — one file to read when
  scroll behavior is wrong.
- Search semantics live in one tested hook — "what clears search" answerable
  in one place.

## Open questions for Sol
1. Is the hook split right, or should scroll+keyboard merge (edge-pinning
   spans both)? Where does viewableRange belong?
2. SidebarShell as component vs. render-prop/slot pattern given the two panes'
   differing list types (FlashList vs FlatList — should contacts move to
   FlashList for true symmetry?)
3. Search-in-ListHeader is a Milad design decision (rides the scroll on
   desktop). Given FlashList header sensitivities, what hardening rules make
   an input in a virtualized header SAFE long-term (stable data source is done;
   what else)?
4. Sequencing: can this land as one refactor PR or must it be sliced? What's
   the regression test list (the Playwright repro harness now exists —
   scratchpad/repro-search.mjs pattern — should it become a checked-in e2e)?
5. What belongs in shared/ vs client-only (inbox-model is shared-adjacent)?
