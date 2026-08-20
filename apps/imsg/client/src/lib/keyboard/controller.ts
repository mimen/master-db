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

/**
 * How long a pending focus stays armed. Long enough for React to unmount the
 * old target and mount the replacement, short enough that a request which
 * already landed can't hijack focus from something the user did afterwards.
 */
const PENDING_FOCUS_MS = 400;
let pendingFocusTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Focus a target now, or as soon as it mounts (pending-focus).
 *
 * Arms BOTH paths deliberately. Callers request focus while reacting to a
 * selection change (see index.tsx's openChat), at which point the currently
 * registered target is often the one about to be torn down — ThreadView is
 * keyed by chat guid, so switching conversations unmounts the old composer
 * and mounts a new one. Focusing only the live target would hand focus to a
 * dying element and lose it; arming only the pending path would miss the
 * case where nothing remounts (re-opening the SAME chat). So: try the
 * current target, and leave the request armed briefly so whichever composer
 * mounts next claims it. Expires so a stale request can't steal focus later.
 */
export function requestFocus(id: string): void {
  pendingFocus = id;
  if (pendingFocusTimer) clearTimeout(pendingFocusTimer);
  pendingFocusTimer = setTimeout(() => {
    if (pendingFocus === id) pendingFocus = null;
    pendingFocusTimer = null;
  }, PENDING_FOCUS_MS);

  const focus = focusTargets.get(id);
  if (focus) setTimeout(focus, 0);
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
/** Returns false only for `navigation.close` when nothing was open to close. */
export function runCommand(id: CommandId, _source: CommandSource): boolean {
  const rt = runtime;
  if (!rt) return false;
  switch (id) {
    case "palette.open":
      rt.openPalette();
      return true;
    case "conversation.new":
      rt.openNewMessage();
      return true;
    case "conversation.next":
      rt.moveSelection(1);
      return true;
    case "conversation.previous":
      rt.moveSelection(-1);
      return true;
    case "conversation.activate":
      rt.activateSelection();
      return true;
    case "composer.focus":
      // Deliberately not routed through the runtime: "put the cursor in the
      // reply box of whatever conversation is open" needs no screen state,
      // and requestFocus already handles the not-yet-mounted case.
      requestFocus("composer");
      return true;
    case "conversation.find":
      rt.findInConversation();
      return true;
    case "conversation.archive":
      rt.archiveSelected();
      return true;
    case "conversation.markUnread":
      rt.markUnreadSelected();
      return true;
    case "conversation.details":
      rt.toggleDetails();
      return true;
    case "list.focusSearch":
      rt.focusListSearch();
      return true;
    case "action.undo":
      rt.undoLast();
      return true;
    case "navigation.escape":
      rt.escape();
      return true;
    case "navigation.close":
      return rt.closePanel();
    case "help.open":
      rt.openHelp();
      return true;
  }
}
