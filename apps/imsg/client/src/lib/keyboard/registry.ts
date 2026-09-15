import type { CommandDefinition, CommandId, KeyBinding } from "./types";

/** Single source of truth: every command, once. Help/palette render from this. */
export const COMMANDS: readonly CommandDefinition[] = [
  { id: "navigation.escape", title: "Glide mode (from composer) / close", group: "Navigation" },
  { id: "navigation.close", title: "Close panel / window", group: "Navigation" },
  { id: "conversation.next", title: "Next conversation", group: "Navigation" },
  { id: "conversation.previous", title: "Previous conversation", group: "Navigation" },
  { id: "conversation.activate", title: "Reply to selected", group: "Navigation" },
  { id: "composer.focus", title: "Reply (focus composer)", group: "Navigation" },
  { id: "conversation.settle", title: "Settle / un-settle conversation", group: "Conversation" },
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
 * Bindings per docs/keyboard-design.md: compose-first, with an Esc-entered
 * list-navigation ("glide") mode.
 *
 * Triage is a global chord, not a glide key. Opening a conversation leaves
 * glide and focuses the composer, so a list-scope letter reached the user as
 * typed text rather than as a command — the triage shortcut was unreachable in
 * the one state the user is in most of the time. Chords carry a modifier, so
 * they can be editable-safe and fire from the composer.
 */
export const BINDINGS: readonly KeyBinding[] = [
  // Global chords — safe while typing.
  { commandId: "palette.open", combo: "mod+k", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.find", combo: "mod+f", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.details", combo: "mod+i", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "navigation.escape", combo: "escape", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: false },
  { commandId: "help.open", combo: "mod+/", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  // Search the conversation LIST from anywhere (⌘F is find-in-conversation).
  { commandId: "list.focusSearch", combo: "mod+shift+f", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  // The browser keeps ⌘N and ⌘W for itself, so these two only ever land in the
  // desktop shell — where the Tauri native menu dispatches the same command ids
  // (desktop/src-tauri/src/lib.rs). Hidden from help because the menu already
  // advertises them, and in a plain browser tab they do not fire at all.
  { commandId: "conversation.new", combo: "mod+n", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true, hidden: true },
  { commandId: "navigation.close", combo: "mod+w", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true, hidden: true },

  // Triage. Editable-safe on purpose: the composer is where the user lives.
  { commandId: "conversation.settle", combo: "mod+e", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  { commandId: "conversation.markUnread", combo: "mod+u", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },
  // ⌘⇧Z, not ⌘Z. The dispatcher listens on the capture phase, so binding ⌘Z
  // would take text undo away from the composer entirely rather than share it.
  { commandId: "action.undo", combo: "mod+shift+z", scope: "global", allowInEditable: true, allowRepeat: false, preventDefault: true },

  // Navigation glides from anywhere (app load included) whenever focus is NOT
  // in a text field — j/k and the arrows are identical. While typing, arrows
  // move the caret and letters type (editable-unsafe). Pressing any of these
  // outside a field enters glide mode (runtime.moveSelection does that).
  { commandId: "conversation.next", combo: "j", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.next", combo: "arrowdown", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.previous", combo: "k", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.previous", combo: "arrowup", scope: "global", allowInEditable: false, allowRepeat: true, preventDefault: true },
  { commandId: "conversation.activate", combo: "enter", scope: "list", allowInEditable: false, allowRepeat: false, preventDefault: true },
  // Enter OUTSIDE glide mode = jump into the open conversation's composer.
  // ORDER IS LOAD-BEARING: matchBinding returns the first match and skips
  // list-scope bindings unless glide is active, so the list-scope Enter above
  // must stay ahead of this one — in glide, Enter activates the selected row;
  // everywhere else (e.g. straight after ⌘K opens a chat) it starts a reply.
  { commandId: "composer.focus", combo: "enter", scope: "global", allowInEditable: false, allowRepeat: false, preventDefault: true },
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

export function isCommandId(value: string): value is CommandId {
  return COMMANDS.some((command) => command.id === value);
}

/** Help entries derived from the registry — cannot drift from behavior. */
export function helpEntries(): HelpEntry[] {
  return COMMANDS.flatMap((command) => {
    const combos = BINDINGS.filter((b) => b.commandId === command.id && !b.hidden);
    if (combos.length === 0) return [];
    return [{ title: command.title, keys: combos.map((b) => formatCombo(b.combo)) }];
  });
}
