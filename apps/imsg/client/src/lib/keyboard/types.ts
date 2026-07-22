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
  | "conversation.find"
  | "conversation.archive"
  | "conversation.toggleUnread"
  | "conversation.details"
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
  findInConversation(): void;
  archiveSelected(): void;
  toggleUnreadSelected(): void;
  toggleDetails(): void;
  escape(): void;
}
