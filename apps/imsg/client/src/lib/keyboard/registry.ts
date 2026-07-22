import type { CommandDefinition, KeyBinding } from "./types";

/** Single source of truth: every command, once. Help/palette render from this. */
export const COMMANDS: readonly CommandDefinition[] = [
  { id: "navigation.escape", title: "Glide mode (from composer) / close", group: "Navigation" },
  { id: "conversation.next", title: "Next conversation", group: "Navigation" },
  { id: "conversation.previous", title: "Previous conversation", group: "Navigation" },
  { id: "conversation.activate", title: "Reply to selected", group: "Navigation" },
  { id: "conversation.archive", title: "Archive / unarchive", group: "Conversation" },
  { id: "conversation.markUnread", title: "Mark unread", group: "Conversation" },
  { id: "action.undo", title: "Undo last action", group: "Conversation" },
  { id: "conversation.new", title: "New message", group: "Conversation" },
  { id: "conversation.details", title: "Toggle details", group: "Conversation" },
  { id: "conversation.find", title: "Find in conversation", group: "Conversation" },
  { id: "list.focusSearch", title: "Search conversations", group: "General" },
  { id: "palette.open", title: "Search", group: "General" },
  { id: "help.open", title: "Keyboard shortcuts", group: "General" },
] as const;

/**
 * Bindings per docs/keyboard-design.md (Slice 2): compose-first with an
 * Esc-entered list-navigation ("glide") mode where single keys act. list-scope
 * bindings never fire while a text field has focus (fail-closed) and only when
 * glide mode is active.
 */
export const BINDINGS: readonly KeyBinding[] = [
  // Global chords — safe while typing.
  { commandId: "palette.open", combo: "mod+k", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.find", combo: "mod+f", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.details", combo: "mod+i", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "navigation.escape", combo: "escape", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: false },
  { commandId: "help.open", combo: "mod+/", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  // Browser-reserved; fires only under the future Tauri shell's native menu.
  { commandId: "conversation.new", combo: "mod+n", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true, hidden: true },

  // Navigation glides from anywhere (app load included) whenever focus is NOT
  // in a text field — j/k and the arrows are identical. While typing, arrows
  // move the caret and letters type (editable-unsafe). Pressing any of these
  // outside a field enters glide mode (runtime.moveSelection does that).
  { commandId: "conversation.next", combo: "j", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.next", combo: "arrowdown", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.previous", combo: "k", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.previous", combo: "arrowup", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.activate", combo: "enter", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.archive", combo: "e", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.markUnread", combo: "u", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  { commandId: "action.undo", combo: "z", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.new", combo: "c", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  { commandId: "list.focusSearch", combo: "/", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  { commandId: "help.open", combo: "shift+?", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
] as const;

const KEY_SYMBOLS: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
  enter: "↵",
};

/** "mod+shift+e" → "⌘⇧E" for the help view. */
export function formatCombo(combo: string): string {
  if (combo === "shift+?") return "?";
  return combo
    .split("+")
    .map((part) => KEY_SYMBOLS[part] ?? part.toUpperCase())
    .join("");
}

export interface HelpEntry {
  title: string;
  keys: string[];
}

/** Help entries derived from the registry — cannot drift from behavior. */
export function helpEntries(): HelpEntry[] {
  return COMMANDS.flatMap((command) => {
    const combos = BINDINGS.filter((b) => b.commandId === command.id && !b.hidden);
    if (combos.length === 0) return [];
    return [{ title: command.title, keys: combos.map((b) => formatCombo(b.combo)) }];
  });
}
