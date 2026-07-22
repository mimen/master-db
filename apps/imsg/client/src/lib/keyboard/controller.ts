import { BINDINGS } from "./registry";
import type { CommandId, CommandSource, KeyBinding, KeyboardRuntime } from "./types";

/**
 * Matches events against the binding registry and executes commands through the
 * registered runtime. Pure logic — no browser globals, safe in any module graph.
 */

let runtime: KeyboardRuntime | null = null;

export function setKeyboardRuntime(rt: KeyboardRuntime | null): void {
  runtime = rt;
}

/** The minimal event shape we match on (KeyboardEvent-compatible). */
export interface KeyStroke {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function comboMatches(combo: string, e: KeyStroke): boolean {
  const parts = combo.split("+");
  const key = parts[parts.length - 1] ?? "";
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  return (
    e.key.toLowerCase() === key &&
    (e.metaKey || e.ctrlKey) === wantMod &&
    e.shiftKey === wantShift &&
    e.altKey === wantAlt
  );
}

export function matchBinding(e: KeyStroke): KeyBinding | null {
  for (const binding of BINDINGS) {
    if (comboMatches(binding.combo, e)) return binding;
  }
  return null;
}

export function runCommand(id: CommandId, _source: CommandSource): void {
  const rt = runtime;
  if (!rt) return;
  switch (id) {
    case "palette.open":
      return rt.openPalette();
    case "conversation.new":
      return rt.openNewMessage();
    case "conversation.next":
      return rt.moveSelection(1);
    case "conversation.previous":
      return rt.moveSelection(-1);
    case "conversation.find":
      return rt.findInConversation();
    case "conversation.archive":
      return rt.archiveSelected();
    case "conversation.toggleUnread":
      return rt.toggleUnreadSelected();
    case "conversation.details":
      return rt.toggleDetails();
    case "navigation.escape":
      return rt.escape();
    case "help.open":
      return rt.openHelp();
  }
}
