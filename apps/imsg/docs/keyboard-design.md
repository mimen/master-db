# Keyboard interaction design — FINAL (Fable + Sol synthesis)

Status: agreed design, pending Milad sign-off. Supersedes `keyboard-design-draft.md`.
Sol's full review: session task output 2026-07-22 (findings folded in here).

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
- Triage chains work: `Esc, j, e, j, u, Enter`.

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
| ⌘I | Toggle details pane |
| Esc | Stepwise (see ladder below) |
| ⌘N | Tauri shell only; in PWA: palette or list-mode `c` |

List-navigation mode (single keys — safe because focus is not in a text field):
| Key | Action |
|---|---|
| j / ↓ | Next conversation (follows the RENDERED order: priority shelf + filtered list) |
| k / ↑ | Previous conversation |
| e | Archive (unarchive in Archived view) — the Gmail/Superhuman standard |
| u | Mark unread (not a toggle; activation already marks read) |
| c | New message |
| / | Focus list search (scrolls the header into view first) |
| Enter | Activate selection → composer |
| ? | Shortcut reference (optional) |

Composer:
| Key | Action |
|---|---|
| Enter / ⇧Enter | Send / newline (+ composition & repeat guards; in-flight send ref) |
| ⌥↑ / ⌥↓ | Prev/next conversation without leaving composer (Slack precedent). Milad triages while typing — shipping in v1. |
| ↑ (empty composer) | Later: edit last outgoing (Slack/Discord), only with full eligibility guards |

Removed / never advertise: `⌘⇧E`, `⌘⇧U` (encoded implementation failures),
`⌘↑/⌘↓` (macOS text-system commands — replaced by ⌥↑/⌥↓), bare `i` (use ⌘I),
`p` pin (palette-only), `⌘/` (palette subsumes it once shipped).

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
