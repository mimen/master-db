# Keyboard interaction design — FINAL (Fable + Sol synthesis)

Status: agreed design, pending Milad sign-off. Supersedes `keyboard-design-draft.md`.
Sol's full review: session task output 2026-07-22 (findings folded in here).

Revised 2026-09-15 by the one-triage-gesture change: Later and Archive are gone,
Settle is the only triage gesture, and triage moved from bare glide letters to
global chords. The bindings tables below describe the current registry. The
implementation-slice notes near the end are kept as a record of the original
plan, not as a description of what is bound today.

## The model: compose-first with an explicit list-navigation mode

A messaging app's dominant act is replying, so the composer stays the default
destination — but a deliberate `Esc` enters **list-navigation mode**, where
Superhuman-style single keys work. Best of both:

- Selecting a conversation (click, palette, search, `Enter` from list) →
  **composer focused**, reply immediately. This selection carries `"reply"` intent.
- `Esc` from a plain composer → **list-navigation mode** (draft preserved).
- `j`/`k` (or arrows) in list mode → move selection, thread previews, **focus
  stays in the list**. This carries `"preview"` intent.
- `Enter` → back into the composer of the selected chat (`"reply"`).
- Printable characters in list mode do **nothing** (no type-anywhere — it cannot
  coexist with single-key commands; IME/dead-key/emoji input made the manual
  append wrong anyway).
- Triage chains work: `Esc, j, ⌘E, j, ⌘U, Enter` — and the chords also fire
  without leaving the composer, which is where triage actually happens.

**Selection intent is explicit** — `selectConversation(chat, "reply" | "preview")`:
- `"reply"`: focus composer, mark read.
- `"preview"`: render thread, do NOT mark read, no focus steal.
This fixes a real bug Sol caught: j/k scanning would otherwise mark every
visited conversation read (ThreadView unconditionally calls markRead today).

**No Tab hijacking.** Tab keeps normal DOM order through real controls. Modals
trap Tab (focus containment); that is unrelated to list mode. (Draft's
Tab-cycles-zones idea was a misapplication of the W3C composite-widget pattern.)

## Bindings (final)

Global (work everywhere, incl. composer):
| Key | Action |
|---|---|
| ⌘K | Command palette (commands + jump-to-conversation, roving ↑/↓ + Enter) |
| ⌘F | Find in conversation (browser CAN yield this via preventDefault) |
| ⌘⇧F | Search the conversation list |
| ⌘I | Toggle details pane |
| ⌘E | Settle / un-settle the selected conversation |
| ⌘U | Mark unread (not a toggle; activation already marks read) |
| ⌘⇧Z | Undo the last settle or mark-unread |
| ⌘/ | Shortcut reference |
| Esc | Stepwise (see ladder below) |
| ⌘N, ⌘W | Tauri shell only — the browser keeps both, and the native menu dispatches the same command ids |

Triage is a chord, not a glide letter. A bare `e` fired only in glide mode with
focus outside a text field, and opening a conversation leaves glide and focuses
the composer — so in the state the user is in most of the time, `e` typed the
letter e and the shortcut was unreachable. A chord carries a modifier, so it can
be editable-safe and fire from the composer. ⌘⇧Z rather than ⌘Z: the dispatcher
listens on the capture phase, so a global ⌘Z would take text undo away from the
composer entirely rather than share it.

Outside a text field, no mode needed:
| Key | Action |
|---|---|
| j / ↓ | Next conversation (follows the RENDERED order: priority shelf + filtered list) |
| k / ↑ | Previous conversation |
| Enter | Focus the composer of the open conversation |

List-navigation mode (glide) adds exactly one binding, and it is the only
list-scope binding left:
| Key | Action |
|---|---|
| Enter | Activate the selected row → composer |

Composer:
| Key | Action |
|---|---|
| Enter / ⇧Enter | Send / newline (+ composition & repeat guards; in-flight send ref) |
| ↑ (empty composer) | Later: edit last outgoing (Slack/Discord), only with full eligibility guards |

Retired, and still retired: `⌘⇧E` and `⌘⇧U`, shifted chords that encoded an
implementation failure rather than an intent. The `⌘E` and `⌘U` above are not
those chords coming back — the shifted forms are still bound to nothing. They
are the replacements for the bare glide letters, chosen for the reason in the
paragraph above. Also retired: `⌘↑/⌘↓` (macOS text-system commands), `⌥↑/⌥↓`
(deferred per Sol — Esc+glide covers it), bare `i` (use ⌘I), `p` pin
(palette-only).

Deleted as bare keys by the one-triage-gesture change: `e` `u` `z` `c` `/` `?`,
and `h` with Later. Deleting `c` costs nothing because ⌘N reaches the app
through the Tauri native menu (`desktop/src-tauri/src/lib.rs`), which advertises
the shortcut itself. `⌘/` is bound and shown in help; the palette never
subsumed it.

**Undo:** settle and mark-unread record an undoable last action, and ⌘⇧Z reverts
it. Undo only ever restores a flag, never clears one, so it cannot hide a
message the user has not seen — which is also why un-settle is not itself
undoable. (Milad request, 2026-07-22.)

## Architecture (build in-house; no cmdk/kbar/react-hotkeys-hook)

The hard parts — RNW capture-phase listening, editable-target detection, scope
precedence, focus restoration, IME, Tauri command execution — are not solved by
the libraries; they're DOM-first and would enter the native module graph.

```
client/src/lib/keyboard/
├── types.ts          # CommandId, ScopeKind, CommandDefinition, KeyBinding
├── commands.ts       # semantic commands: id, title, group, isEnabled, execute
├── bindings.ts       # combo → command, per scope: allowInEditable, allowRepeat, preventDefault
├── controller.ts     # match(event) → binding; run(commandId, source)
├── dispatcher.web.ts # THE one capture-phase keydown listener
└── dispatcher.native.ts  # no-op
client/src/components/
├── keyboard-provider.web.tsx
├── keyboard-provider.native.tsx  # no-op
└── command-palette.tsx
```

- **Commands ≠ bindings.** A command is semantic (palette, buttons, Tauri menu
  all call `run(commandId, source)`); a binding maps a combo to it per scope.
  One source of truth; help/palette render from it.
- **Scope stack + runtime adapters**, not a scalar enum. Panes register live
  capabilities (`registerList({move, activate, focusSearch})`,
  `registerComposer(...)`, `registerInspector(...)`, `pushOverlay(...)`).
  The keyboard lib imports no components; the pane that owns visual order owns
  keyboard order (priority shelf + filters + pins + search all respected).
- **Focus controller** with restore frames: every overlay/inspector records its
  opener; closing restores it. Pending-focus solves "composer not mounted yet".
  DOM `focusin` is authoritative for scope; the store holds intent only.
- **Fail-closed invariant:** a bare-letter command never executes when
  `event.target` is editable (input/textarea/select/contentEditable), even if
  scope state is stale. Editability check beats everything.
- **Dispatcher guards:** skip `isComposing`/keyCode 229/`Dead`; reject repeat
  unless `allowRepeat` (nav only); reject AltGraph combos (text, not shortcuts).
- **Expo Go safety:** `.native.ts` files are no-ops; no browser globals at
  module scope anywhere in the keyboard lib.
- **Tauri:** menu sends semantic command IDs (never simulated keystrokes).
  `⌘W` needs a request/ack shape ("close top panel, else close window").

## Esc precedence ladder (first applicable step only — never close-everything)

1. Active IME consumes it
2. Close top modal/popover/palette/action sheet → restore opener
3. Close inline thread search / cancel group-name edit
4. Cancel message edit
5. Cancel reply mode
6. Plain composer → list-navigation mode (draft kept)
7. List mode/inspector active → close inspector, restore list focus
8. Nothing

## Focus-loss cases (test list)

Palette close → exact composer + caret restored · details close → opener
restored · auto-closing inspector on chat switch must not steal focus ·
deleting the selected chat while composing → fall back to list · filter change
removes selected row → deterministic next row · virtualized selected row
unmount → focus never drops to `<body>` · window blur/refocus → no unsolicited
autofocus · RNW Modal traps Tab.

## Implementation slices (each independently shippable)

**Slice 1 — infrastructure, zero behavior change.** Controller + bindings +
web dispatcher; migrate existing shortcuts onto it; exactly ONE keydown
listener (delete the two current ones: index.tsx handler + composer
type-anywhere/Enter listeners — Enter-to-send moves into the registry with
composition/repeat/in-flight guards); editable fail-closed; help renders from
registry. DoD: no visible change on web, no keyboard code in Expo Go graph.

**Slice 2 — compose-first navigation mode.** Remove type-anywhere; selection
intent reply/preview (incl. mark-read gating); remove unconditional composer
autofocus (today it steals focus on every ThreadView remount — the model can't
work until that's gone); scope adapters; Esc ladder; `j/k/e/u/c//`/Enter over
the rendered inbox model; ⌥↑/⌥↓ in composer; focus-visible styling; drop
⌘⇧E/⌘⇧U/⌘↑/⌘↓.

**Slice 3 — palette + roving selection + shell bridge.** ⌘K palette (commands +
chat jump) replacing the static search modal, keeping full contact/message
search reachable; roving ↑/↓/Home/End/Enter, stable selection across async
updates — same primitive applied to search results and new-chat recipients;
modal focus trap/restore; Tauri menu → `run(commandId, "native-menu")`.

## Corrections to earlier statements (for the record)

- `⌘F` CAN be captured in the browser (preventDefault works); Tauri was never a
  prerequisite for it. tauri-handoff.md updated accordingly.
- `⌘↑/⌘↓` were a mistake to ship — they're macOS text-editing commands
  (start/end of document) and we were overriding real caret behavior.
