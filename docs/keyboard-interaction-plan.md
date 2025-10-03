# Keyboard Interaction Plan

## Context
Our goal is to replace default browser focus traversal and shortcut handling with application-defined behavior. The UI will coordinate focus, selection, and action shortcuts for the sidebar, list/table views, and future overlays (e.g., command palette). Accessibility is out of scope for now—we just need something that feels great for a single power user. This document captures the guiding principles, state model, and incremental build plan.

## Design Principles
- **Single source of truth for focus**: Application state tracks the active region (sidebar, list, table, overlay) and the focused entity within that region. DOM focus mirrors state via controlled `tabIndex` + `.focus()` calls.
- **Centralized key routing**: A global hotkey layer owns `keydown` events, looks up the active scope, and dispatches actions. Scopes can push/pop to support modals or overlays.
- **Minimal default suppression**: Call `preventDefault()` only when the app supplies a replacement. Preserve OS-level combos (e.g., `cmd+a`, `cmd+c`).
- **Custom focus affordances**: Style focused elements explicitly so it’s always clear which item is active without relying on browser defaults.
- **Composable layers**: Each major surface (sidebar, table, overlays) exposes handlers that plug into the global layer. Local handlers handle fine-grained navigation, while shared commands (e.g., `ctrl+k`) live at the root.

## Incremental Build Outline
1. Establish focus state in React context (region + item identifiers) and utilities to move focus.
2. Ship `useGlobalHotkeys` hook to register scopes and dispatchers; integrate with `<App>` so only one listener is attached.
3. Refactor sidebar navigation to use roving `tabIndex` and respond to arrow keys via scoped handlers.
4. Extend table/grid interactions with scrolling controls, selection actions, and typeahead.
5. Layer future command palette on the existing scope stack without breaking base navigation.

## Focus State Sketch
```
State: Sidebar → List → Table → Overlay (optional)

Sidebar
  • index: section id
  • arrow up/down → move
  • enter → List.load(context)

List
  • collectionId, itemIndex
  • arrow keys → move item focus
  • tab → push Table scope (skip browser tab)

Table
  • rowIndex, columnIndex, scrollOffset
  • arrow keys/PageUp/PageDown → move
  • space/enter → invoke action
  • esc → pop to List

Overlay (e.g., command palette)
  • hasOwnFocusStack = true
  • esc → pop overlay; restore previous focus
```
Each transition updates shared focus context and explicitly focuses the DOM node associated with the new target.

## Hook Design Snapshot
- `useGlobalHotkeys()` attaches a single `keydown` listener at mount, normalized for platform modifiers.
- Consumers register handlers per scope via `registerScope(scopeId, { isActive, handlers })`.
- Scope stack resolves handlers top-down; first handler returning `true` stops propagation.
- Hook exposes imperative helpers (`pushScope`, `popScope`, `setActiveScope`) to coordinate overlays.

Next step is to wire this hook into the app and migrate sidebar navigation to the new model.
