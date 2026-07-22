import type { CommandDefinition, KeyBinding } from "./types";

/** Single source of truth: every command, once. Help/palette render from this. */
export const COMMANDS: readonly CommandDefinition[] = [
  { id: "palette.open", title: "Search", group: "General" },
  { id: "conversation.new", title: "New message", group: "Conversation" },
  { id: "conversation.next", title: "Next conversation", group: "Navigation" },
  { id: "conversation.previous", title: "Previous conversation", group: "Navigation" },
  { id: "conversation.find", title: "Find in conversation", group: "Conversation" },
  { id: "conversation.archive", title: "Archive / unarchive", group: "Conversation" },
  { id: "conversation.toggleUnread", title: "Mark read / unread", group: "Conversation" },
  { id: "conversation.details", title: "Toggle details", group: "Conversation" },
  { id: "navigation.escape", title: "Close panel", group: "General" },
  { id: "help.open", title: "Keyboard shortcuts", group: "General" },
] as const;

/**
 * Slice 1 bindings — the pre-existing set, verbatim, so behavior is unchanged.
 * Slice 2 retires ⌘⇧E/⌘⇧U/⌘↑/⌘↓ in favor of list-navigation single keys.
 */
export const BINDINGS: readonly KeyBinding[] = [
  { commandId: "palette.open", combo: "mod+k", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  // Browser-reserved; fires only under the future Tauri shell's native menu.
  { commandId: "conversation.new", combo: "mod+n", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true, hidden: true },
  { commandId: "conversation.next", combo: "mod+arrowdown", scope: "global", allowInEditable: true, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.previous", combo: "mod+arrowup", scope: "global", allowInEditable: true, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.find", combo: "mod+f", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.archive", combo: "mod+shift+e", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.toggleUnread", combo: "mod+shift+u", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.details", combo: "mod+i", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "navigation.escape", combo: "escape", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: false },
  { commandId: "help.open", combo: "mod+/", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
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
