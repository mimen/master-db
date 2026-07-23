/**
 * Keyboard system types — see docs/keyboard-design.md.
 * Commands are semantic (callable from keyboard, palette, buttons, or the
 * future Tauri menu); bindings map key combos to commands per scope.
 * Nothing in this module may touch browser globals at module scope.
 */

export type CommandId =
  | "palette.open"
  | "conversation.new"
  | "conversation.next"
  | "conversation.previous"
  | "conversation.activate"
  | "conversation.find"
  | "conversation.archive"
  | "conversation.markUnread"
  | "conversation.details"
  | "list.focusSearch"
  | "action.undo"
  | "navigation.escape"
  | "help.open";

export type ScopeKind = "global" | "list" | "thread" | "composer" | "inspector" | "overlay";

export type CommandSource = "keyboard" | "palette" | "button" | "native-menu";

export interface CommandDefinition {
  readonly id: CommandId;
  /** Human title — rendered in the help view and (later) the palette. */
  readonly title: string;
  readonly group: "Navigation" | "Conversation" | "General";
}

export interface KeyBinding {
  readonly commandId: CommandId;
  /** e.g. "mod+k", "mod+shift+e", "mod+arrowdown", "escape" */
  readonly combo: string;
  readonly scope: ScopeKind;
  /** May fire while an input/textarea/contentEditable has focus. */
  readonly allowInEditable: boolean;
  /** Held-key auto-repeat allowed (navigation only). */
  readonly allowRepeat: boolean;
  readonly preventDefault: boolean;
  /** Hidden from the help view (e.g. bindings pending a native shell). */
  readonly hidden?: boolean;
}

/**
 * Live capabilities the app registers with the controller. Implemented in
 * index.tsx over refs so dispatch always acts on current state (no stale
 * closures). Slice 2 replaces this with per-pane scope adapters.
 */
export interface KeyboardRuntime {
  openPalette(): void;
  openNewMessage(): void;
  openHelp(): void;
  moveSelection(delta: -1 | 1): void;
  activateSelection(): void;
  findInConversation(): void;
  archiveSelected(): void;
  markUnreadSelected(): void;
  toggleDetails(): void;
  focusListSearch(): void;
  undoLast(): void;
  escape(): void;
}

/**
 * Registered by the conversation list pane so keyboard order follows the
 * RENDERED order (priority shelf + filters + pins), which the raw chats array
 * does not reflect. The pane that owns visual order owns keyboard order.
 */
export interface ListAdapter {
  move(delta: -1 | 1): void;
  activate(): void;
  focusSearch(): void;
  /** Clears an active list search. Returns true if there was one to clear —
   * the Esc ladder consumes the keypress in that case. Optional so in-flight
   * pane work isn't broken; wired by the search-mode redesign. */
  clearSearch?(): boolean;
  /** After an action removes `guid` from the list (archive), glide onto its
   * neighbor (next, else previous) instead of leaving the cursor dangling. */
  selectNeighborOf(guid: string): void;
}
