import { BINDINGS } from "./registry";
import type { CommandId, CommandSource, KeyBinding, KeyboardRuntime, ListAdapter } from "./types";

/**
 * Matches events against the binding registry and executes commands through the
 * registered runtime. Also owns the small pieces of interaction state the
 * design calls for: glide (list-navigation) mode, the list adapter, and focus
 * targets with pending-focus (composer may not be mounted yet when focus is
 * requested). Pure logic — no browser globals; safe in any module graph.
 */

let runtime: KeyboardRuntime | null = null;

export function setKeyboardRuntime(rt: KeyboardRuntime | null): void {
  runtime = rt;
}

// ------------------------------------------------------------- glide mode
let listMode = false;
const listModeListeners = new Set<() => void>();

export function setListMode(on: boolean): void {
  if (listMode === on) return;
  listMode = on;
  for (const l of listModeListeners) l();
}

export function isListMode(): boolean {
  return listMode;
}

export function subscribeListMode(listener: () => void): () => void {
  listModeListeners.add(listener);
  return () => void listModeListeners.delete(listener);
}

// ------------------------------------------------------------ list adapter
let listAdapter: ListAdapter | null = null;

export function registerListAdapter(adapter: ListAdapter): () => void {
  listAdapter = adapter;
  return () => {
    if (listAdapter === adapter) listAdapter = null;
  };
}

export function getListAdapter(): ListAdapter | null {
  return listAdapter;
}

// ------------------------------------------------------------ focus targets
const focusTargets = new Map<string, () => void>();
let pendingFocus: string | null = null;

export function registerFocusTarget(id: string, focus: () => void): () => void {
  focusTargets.set(id, focus);
  if (pendingFocus === id) {
    pendingFocus = null;
    // Defer a tick so the mounting component finishes before focus lands.
    setTimeout(focus, 0);
  }
  return () => {
    if (focusTargets.get(id) === focus) focusTargets.delete(id);
  };
}

/** Focus a target now, or as soon as it mounts (pending-focus). */
export function requestFocus(id: string): void {
  const focus = focusTargets.get(id);
  if (focus) {
    setTimeout(focus, 0);
  } else {
    pendingFocus = id;
  }
}

// ---------------------------------------------------------------- matching
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
    // list-scope bindings only exist while glide mode is active.
    if (binding.scope === "list" && !listMode) continue;
    if (comboMatches(binding.combo, e)) return binding;
  }
  return null;
}

// --------------------------------------------------------------- execution
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
    case "conversation.activate":
      return rt.activateSelection();
    case "conversation.find":
      return rt.findInConversation();
    case "conversation.archive":
      return rt.archiveSelected();
    case "conversation.markUnread":
      return rt.markUnreadSelected();
    case "conversation.details":
      return rt.toggleDetails();
    case "list.focusSearch":
      return rt.focusListSearch();
    case "action.undo":
      return rt.undoLast();
    case "navigation.escape":
      return rt.escape();
    case "help.open":
      return rt.openHelp();
  }
}
