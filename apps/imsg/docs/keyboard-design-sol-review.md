# Keyboard interaction redesign — Sol review

**Verdict: revise before implementation.** Keep the zone concept as an internal dispatch/focus model, but reject the draft’s list-first default. This is a messaging app: the normal path must remain **select conversation → type reply immediately**.

Reference files:

- [keyboard-design-draft.md](/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/docs/keyboard-design-draft.md)
- [index.tsx](/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/client/src/app/(tabs)/index.tsx)
- [composer.tsx](/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/client/src/components/composer.tsx)
- [conversation-list-pane.tsx](/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/client/src/components/conversation-list-pane.tsx)
- [thread-view.tsx](/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/client/src/components/thread-view.tsx)
- [tauri-handoff.md](/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/docs/tauri-handoff.md)

## Decision-changing findings

### High — The right model is compose-first with an explicit navigation mode

`DRAFT:55-59` makes list focus the default after keyboard selection and proposes cycling among list/thread/composer. That over-optimizes email-style triage.

Recommended behavior:

- Pointer selection, command-palette chat jump, and `Enter` on a selected conversation focus the composer.
- `Esc` from a plain composer enters list-navigation mode without discarding the draft.
- `j`/`k` movement while already in list-navigation mode changes the selected thread but retains list focus.
- `Enter` returns to the composer.
- Printable characters do not implicitly leave list-navigation mode.

This preserves the one-keystroke reply path for ordinary use while making `Esc, j, e, j, u` triage chains possible.

The implementation must make autofocus intentional. `COMPOSER:135-154` currently focuses on every `chatGuid` change. Because `INDEX:314` remounts `ThreadView` when the selected GUID changes, the first `j`/`k` navigation would remount `Composer` and immediately steal focus. The proposed zone model cannot function until that is removed.

Use an explicit selection intent:

```ts
type ConversationSelectionIntent = "reply" | "preview";

function selectConversation(
  chat: ChatSummary,
  intent: ConversationSelectionIntent,
): void;
```

- Pointer, palette, search result, and list `Enter`: `"reply"`.
- List `j`/`k`: `"preview"`.

Do not make `Composer` infer intent from mount timing.

### High — Do not override Tab to cycle zones

`DRAFT:58-59` misapplies the W3C composite-widget guidance. Tab should move through actual interactive controls: filters, search, conversations, thread header buttons, composer, attachment button, inspector controls, and so on.

A global three-zone Tab loop would:

- Skip accessible controls.
- Fight browser and assistive-technology expectations.
- Become wrong whenever the inspector, search shelf, filter popover, or attachment sheet is open.
- Require focus traps that are unrelated to zone switching.

Let normal tab order work. Use `Esc` to enter list-navigation mode. Inside a modal, trap Tab within that modal; that is modal focus containment, not zone cycling.

### High — Keyboard navigation must follow the rendered inbox model

`INDEX:174-179` moves through the raw `chats` array. The visible pane instead renders `deriveInboxModel(...).listChats` at `CONVERSATION-LIST-PANE:94,164-166`, with:

- Active state/type filters.
- Pane-local text/deep-search filtering.
- Priority conversations split into a separate shelf.
- Pinned chats reordered ahead of unpinned chats.

Consequently, current keyboard order can disagree with screen order.

The list pane should register a navigation adapter based on its current rendered model:

```ts
interface ConversationListKeyboardAdapter {
  moveSelection(delta: -1 | 1): void;
  activateSelection(): void;
  focusSearch(): void;
}

function registerKeyboardScope(
  scope: "list",
  adapter: ConversationListKeyboardAdapter,
): () => void;
```

Its navigation sequence should be:

```ts
const navigableChats = model.showPriorityShelf
  ? [...model.priority, ...model.listChats]
  : model.listChats;
```

This is preferable to moving all inbox state into a keyboard-owned store. The component that defines visual order should define keyboard order.

### High — A scalar zone store is insufficient

`DRAFT:52-53,84-85` proposes four zones and “top of stack wins,” but the app already has more focus contexts:

- Command/global search modal.
- New-message modal with recipient and message fields.
- Filter popover.
- Action sheets and context menus.
- Inline thread-search shelf.
- Right-hand details/person inspector.
- Group-name editor inside the inspector.
- Reply and edit modes in the composer.

The state should be a **scope stack plus registered focus targets**, not one enum.

The right pane requires its own `inspector` scope; treating every non-primary surface as generic `overlay` loses close behavior, focus restoration, and command availability.

### High — DOM editability must override scope state

The safety invariant is:

> A bare-letter command must never execute when the event target is an input, textarea, select, or content-editable element, even if the scope store incorrectly says `list`.

The current type-anywhere implementation already has most of the necessary detection at `COMPOSER:141-145`.

The dispatcher should fail closed:

```ts
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}
```

A stale scope should cause a shortcut to do nothing, never archive a conversation while the user is typing.

### High — Preview navigation currently marks every visited conversation read

Selection currently clears unread optimistically at `INDEX:169-173`, and `ThreadView` unconditionally calls `api.markRead(chatGuid)` at `THREAD-VIEW:94-100`.

If `j`/`k` becomes a list scanner, passing through five conversations will mark all five read.

Tie read behavior to selection intent:

- `"reply"` selection marks read.
- `"preview"` selection renders the thread without marking read.
- `Enter`, composer focus, or explicit thread activation marks it read.

This is more deterministic than adding a dwell timer and matches the distinction the zone model is introducing.

## Direct answers to the five open questions

### 1. Zone model versus always-composer plus chords

Use a **hybrid compose-first model**.

Zones are useful for dispatch context, overlay precedence, and focus restoration. They should not impose a Gmail-like default on the user. The composer remains the default destination after normal chat selection. List-navigation mode is entered deliberately with `Esc`.

Do not implement “selected chat always keeps list focus.” Only `j`/`k` selection from an already active list scope should do that.

### 2. Enter-to-compose versus type-anywhere-to-compose

Choose **Enter-to-compose**. Remove type-anywhere.

They cannot coexist with bare `j/k/e/u/c/i/p` commands. Guessing whether a printable key means “type this character” or “execute an action” is a modal trap.

The current manual append at `COMPOSER:147-149` is also incorrect for:

- IME composition.
- Dead keys and accented characters.
- Alternate keyboard layouts.
- Emoji and multi-codepoint input.
- Browser input transformations.

Because the composer remains focused in the normal reply path, removing type-anywhere does not impose an everyday reply-speed penalty. `Enter` is only needed after the user deliberately pressed `Esc` to browse.

### 3. Build versus adopt

Build the dispatcher and palette in-house.

Reasons:

1. RNW requires the capture-phase document listener already proven at `INDEX:238-242`.
2. Text-input classification, scope precedence, focus restoration, IME handling, and Tauri command execution are the difficult parts. `react-hotkeys-hook` does not remove them.
3. `cmdk` and `kbar` are DOM-first. Static imports create unnecessary Metro/Expo Go exposure.
4. The app already has the search data path and React Native primitives needed for the palette.

Use platform files:

```text
client/src/lib/keyboard/
├── commands.ts
├── bindings.ts
├── controller.ts
├── dispatcher.web.ts
├── dispatcher.native.ts
└── types.ts

client/src/components/
├── keyboard-provider.web.tsx
├── keyboard-provider.native.tsx
└── command-palette.tsx
```

`dispatcher.native.ts` and `keyboard-provider.native.tsx` should be no-ops. No module evaluated by Expo Go should touch `document`, `window`, `HTMLElement`, or a Tauri package at module scope.

### 4. Are the proposed bindings correct?

Not entirely. Use the following set.

#### Global

| Binding | Recommendation |
|---|---|
| `⌘K` | Keep: command palette plus chat jump. Matches Superhuman, Linear, and Slack’s command/switcher model. |
| `⌘F` | Keep for in-conversation find. It can be intercepted in the browser now; Tauri is not a prerequisite. |
| `⌘N` | Tauri/native shell only. In the PWA, expose New Message through `⌘K` and list-mode `c`. |
| `⌘I` | Keep for conversation details. This is more recognizably macOS-like than bare `i`. |
| `Esc` | Stepwise close/cancel/navigation behavior, never “close everything.” |
| `⌘/` | Remove after the palette exposes all commands and shortcuts. Add `?` in list mode if a dedicated shortcut reference is still wanted. |

#### List-navigation mode

| Binding | Recommendation |
|---|---|
| `j` / `↓` | Next visible conversation. |
| `k` / `↑` | Previous visible conversation. |
| `e` | Archive; in the Archived view, unarchive. This is the Gmail/Superhuman convention that solves the `⌘E` problem. |
| `u` | Mark unread, not toggle. Opening/activating a conversation already supplies the mark-read operation. |
| `c` | New message. |
| `/` | Focus the list search. |
| `Enter` | Activate the selection and focus its composer. |
| `?` | Optional shortcut reference. |
| `p` | Remove from the default binding set. Pinning is lower-frequency and `p` has inconsistent meanings across products. Keep it in the palette. |
| bare `i` | Remove. Use `⌘I`. |

The `/` action needs a list-pane adapter. Its search input is inside the `FlashList` header at `CONVERSATION-LIST-PANE:202-216` and may have scrolled away. The action must scroll to offset zero and then focus the input.

#### Composer

| Binding | Recommendation |
|---|---|
| `Enter` | Send. |
| `⇧Enter` | Newline. |
| `↑` with an entirely empty composer | Later: edit the latest eligible outgoing message, matching Slack/Discord. Guard text, attachments, reply mode, edit mode, age limit, composition, and repeat. |
| `⌘↑` / `⌘↓` | Remove. These are macOS beginning/end-of-document text commands. |
| Direct conversation-nav chord | Do not ship one in v1. Use `Esc`, then `j/k`. If telemetry later proves a chord is needed, Slack’s `⌥↑/⌥↓` is the recognizable messaging precedent. |

Do not retain `⌘⇧E` or `⌘⇧U` as advertised aliases after list mode ships. They encode implementation failures, not useful conventions.

#### Thread

Defer message-level keyboard navigation and bare `r` reply.

There is no message selection model yet, and `ThreadView` already has special inverted-list wheel handling at `THREAD-VIEW:106-123`. In v1, normal scrolling and Tab access are enough. Do not invent arrow-between-bubbles semantics until message selection has a real visual and accessibility model.

#### Industry summary

- Gmail/Superhuman/Linear justify `j/k`, `e`, `c`, `/`, and Enter activation in a non-editable list context.
- Slack justifies compose-first behavior and command-driven switching.
- Things reinforces standard macOS chords such as `⌘N` and activation/editing through Return; it does not justify stealing printable characters while an editor is active.
- macOS conventions argue strongly against `⌘↑/⌘↓` and `⌘E`.
- `u` as a toggle and `p` as pin are product-specific, not industry standards.

### 5. RNW/Expo/Tauri conflicts

The architecture is viable if these constraints are explicit:

- Keep exactly one capture-phase `keydown` listener on web.
- Remove both existing keyboard listeners:
  - `INDEX:180-242`.
  - `COMPOSER:135-169`.
- Never import DOM-only palette libraries into the native module graph.
- Never access browser globals at module scope.
- Preserve mobile behavior: native Return remains newline and the send button remains authoritative.
- Tauri sends semantic command IDs, not simulated keystrokes.
- Shortcut labels must be surface-aware. Do not advertise `⌘N` as working in the PWA.
- `TAURI-HANDOFF:46-47` is wrong about `⌘F`; browser pages can prevent its default action. `⌘N`, `⌘W`, `⌘T`, and `⌘Q` are the real native-shell cases.
- `TAURI-HANDOFF:107,136-137` refers to `C` and “existing single-key shortcuts,” but the current implementation has no single-key shortcuts. Correct that documentation when this design is finalized.
- A one-way Tauri event is insufficient for `⌘W` if the desired behavior is “close top panel, otherwise close the native window.” That command needs an acknowledgement or must let the web side request window closure when it has nothing left to dismiss.

## Recommended architecture

### Separate commands from bindings

A command is semantic and callable by keyboard, palette, button, or Tauri. A binding is platform/scope-specific.

```ts
type CommandId =
  | "palette.open"
  | "conversation.find"
  | "conversation.next"
  | "conversation.previous"
  | "conversation.activate"
  | "conversation.archive"
  | "conversation.markUnread"
  | "conversation.details"
  | "conversation.new"
  | "conversationList.search"
  | "composer.send"
  | "navigation.escape";

type ScopeKind =
  | "global"
  | "list"
  | "thread"
  | "composer"
  | "inspector"
  | "overlay";

interface CommandDefinition {
  readonly id: CommandId;
  readonly title: string;
  readonly group: string;
  isEnabled(snapshot: KeyboardSnapshot): boolean;
  execute(runtime: CommandRuntime): void;
}

interface KeyBinding {
  readonly commandId: CommandId;
  readonly combo: string;
  readonly scope: ScopeKind;
  readonly allowInEditable: boolean;
  readonly allowRepeat: boolean;
  readonly preventDefault: boolean;
}
```

This remains one source of truth without forcing Tauri menu behavior into key-matching code.

### Use runtime scope adapters, not component imports

The keyboard library should not import `ConversationListPane`, `Composer`, or modal state. Components register their current capabilities:

```ts
interface ListScopeAdapter {
  move(delta: -1 | 1): void;
  activate(): void;
  focusSearch(): void;
}

interface ComposerScopeAdapter {
  focus(): void;
  send(): void;
  cancelTransientState(): boolean;
}

interface InspectorScopeAdapter {
  close(): void;
}

interface OverlayScopeAdapter {
  close(): void;
  focusFirst(): void;
}

interface ScopeRegistry {
  registerList(adapter: ListScopeAdapter): () => void;
  registerComposer(adapter: ComposerScopeAdapter): () => void;
  registerInspector(adapter: InspectorScopeAdapter): () => void;
  pushOverlay(id: string, adapter: OverlayScopeAdapter): () => void;
}
```

This gives the dispatcher live behavior without stale closures and keeps pane-local state—particularly the filtered visual chat order—inside its owning component.

There is no need to move selected-chat domain state into a keyboard store. A stable controller can read a live snapshot ref at dispatch time.

### Focus stack

Each overlay or secondary pane records where focus should return:

```ts
interface FocusFrame {
  readonly id: string;
  readonly kind: "overlay" | "inspector";
  readonly restoreTarget: string;
  close(): void;
}

interface FocusController {
  registerTarget(id: string, focus: () => void): () => void;
  requestFocus(id: string): void;
  push(frame: FocusFrame): void;
  pop(id: string): void;
}
```

A pending focus request solves the “composer is not mounted yet” case after selecting a new conversation.

Update active scope from actual `focusin` events. The store records navigation intent and restoration targets, but DOM focus remains authoritative for editability.

### Dispatcher ordering

```ts
function dispatchKeyboardEvent(event: KeyboardEvent): void {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === "Process" ||
    event.key === "Dead"
  ) {
    return;
  }

  const match = controller.match(event);
  if (!match) return;

  if (event.repeat && !match.allowRepeat) return;
  if (isEditableTarget(event.target) && !match.allowInEditable) return;

  if (match.preventDefault) event.preventDefault();
  controller.run(match.commandId, "keyboard");
}
```

Also reject AltGraph-generated modifier combinations; they are text input, not shortcuts.

### Escape precedence

`Esc` must execute only the first applicable step:

1. Let an active IME consume it.
2. Close the top modal, popover, palette, or action sheet and restore its opener.
3. Close inline thread search or cancel group-name editing.
4. Cancel message editing.
5. Cancel reply mode.
6. From a plain composer, preserve the draft and activate list-navigation mode.
7. If the inspector is active or list mode is already active, close the inspector and restore list focus.
8. Otherwise do nothing.

Current behavior at `INDEX:181-186` closes every surface at once and must not survive the migration.

### Repeat policy

Allow repeat only for reversible navigation:

- `j`, `k`, arrow navigation, and scrolling: allowed.
- Archive, unread, pin, send, activation, new message, palette open, and details toggle: blocked.

The current Enter-to-send listener at `COMPOSER:161-165` also needs composition and repeat guards. Held Enter can otherwise invoke `sendRef.current` more than once before React commits the cleared text. An in-flight send ref is appropriate in addition to rejecting repeat.

### Focus-loss cases to test

- Closing `⌘K` returns to the exact composer and preserves its caret.
- Closing the details pane restores the button or keyboard scope that opened it.
- A conversation change that automatically closes the inspector must not restore focus to the old conversation and steal the requested composer/list focus.
- Deleting the selected conversation while its composer is focused falls back to the list or New Message control.
- Changing filters while the selected row disappears chooses a deterministic next row.
- A virtualized selected row being unmounted does not drop focus to `<body>`.
- Window blur/refocus retains the last valid focus target without unsolicited autofocus.
- RNW `Modal` traps Tab while open.

## Implementation sequence

### Slice 1 — Central dispatcher, no interaction-model change

Ship the foundation while preserving current behavior:

- Add command definitions, bindings, controller, and web/native providers.
- Move the existing modifier shortcuts and Enter-to-send into the central capture listener.
- Generate the current shortcut help from the registry.
- Implement editable-target fail-closed behavior.
- Add IME, dead-key, AltGraph, and repeat handling.
- Ship in-page `⌘F`.
- Remove the two legacy key listeners.
- Add tests for matching, scope precedence, composition, repeat, and stale-scope text-field safety.

Definition of done: exactly one application `keydown` listener, with no visible regression on web and no keyboard module behavior in Expo Go.

### Slice 2 — Compose-first navigation mode

Ship the redesigned interaction:

- Remove type-anywhere.
- Add explicit `"reply"` versus `"preview"` conversation-selection intent.
- Remove unconditional composer mount autofocus.
- Register list/composer/inspector/overlay scope adapters.
- Implement `Esc` into list-navigation mode and `Enter` back to composer.
- Add `j/k`, arrows, `e`, `u`, `c`, `/`, and optional `?`.
- Navigate the pane’s rendered model, including filters, search, pins, and priority shelf.
- Gate mark-read on activation rather than preview.
- Add focus restoration and `:focus-visible` styling.
- Do not intercept Tab.
- Remove `⌘⇧E`, `⌘⇧U`, and `⌘↑/⌘↓` from the advertised binding set.

This slice is independently useful even without the command palette.

### Slice 3 — Palette, search navigation, and shell bridge

- Replace the static `⌘K` search modal with a command palette containing commands plus chat jump.
- Preserve full contact/message search as a distinct palette command; do not silently delete the existing `SearchContent` capability.
- Add roving `↑/↓`, Home/End, Enter, and stable selection across asynchronous result updates.
- Apply the same keyboard-selection primitive to full search and new-message recipient results.
- Trap modal focus and restore the opener on close.
- Connect Tauri menu events to `controller.run(commandId, "native-menu")`.
- Add empty-composer Up-to-edit only after its eligibility rules and tests exist.

---

The repo was not modified: this review route is read-only, so `/Users/mimen/Programming/Repos/convex-db/.worktrees/main/apps/imsg/docs/keyboard-design-sol-review.md` was not created. The full intended review is above.
