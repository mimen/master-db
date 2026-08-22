import {
  parseShellReleaseState,
  type ShellReleaseState,
} from "@shared/release-identity";

import { runCommand } from "./keyboard/controller";
import { isCommandId } from "./keyboard/registry";
import type { CommandId } from "./keyboard/types";

/** Vertical space occupied by AppKit's overlay titlebar outside fullscreen. */
export const NATIVE_TITLEBAR_INSET = 30;

type TauriListenUnlisten = () => void;
type TauriEventPayload = string | Record<string, string | null | undefined>;

type TauriGlobal = {
  core?: {
    invoke: <Result>(command: string) => Promise<Result>;
  };
  event: {
    listen: (
      event: string,
      handler: (event: { payload: TauriEventPayload }) => void,
    ) => Promise<TauriListenUnlisten>;
  };
  window: {
    getCurrentWindow: () => {
      close: () => Promise<void>;
      isFullscreen?: () => Promise<boolean>;
      onResized?: (handler: () => void) => Promise<TauriListenUnlisten>;
    };
  };
};

export type DesktopShellWindow = {
  __TAURI__?: TauriGlobal;
  __IMSG_NATIVE_SHELL__?: boolean;
};

function defaultWindow(): DesktopShellWindow | undefined {
  if (typeof globalThis.window === "undefined") return undefined;
  return globalThis.window as Window & DesktopShellWindow;
}

/** True when the page is running inside the Tauri desktop shell. */
export function isDesktopShell(win: DesktopShellWindow | undefined = defaultWindow()): boolean {
  return win !== undefined && (win.__TAURI__ !== undefined || win.__IMSG_NATIVE_SHELL__ === true);
}

function tauriGlobal(win: DesktopShellWindow | undefined = defaultWindow()): TauriGlobal | null {
  return win?.__TAURI__ ?? null;
}

function closeDesktopWindow(win: DesktopShellWindow | undefined = defaultWindow()): void {
  const tauri = tauriGlobal(win);
  if (!tauri) return;
  void tauri.window.getCurrentWindow().close();
}

/**
 * Mirrors AppKit fullscreen state so web content only reserves titlebar space
 * while the overlay controls are visible. Resize is the Tauri v2 event emitted
 * by native fullscreen transitions.
 */
export function watchDesktopFullscreen(
  onChange: (fullscreen: boolean) => void,
  win: DesktopShellWindow | undefined = defaultWindow(),
): () => void {
  const currentWindow = tauriGlobal(win)?.window.getCurrentWindow();
  if (!currentWindow?.isFullscreen || !currentWindow.onResized) return () => undefined;

  let cancelled = false;
  let reading = false;
  let readAgain = false;
  let unlisten: TauriListenUnlisten | undefined;
  const refresh = (): void => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    void currentWindow.isFullscreen?.().then(
      (fullscreen) => {
        if (!cancelled) onChange(fullscreen);
      },
      () => undefined,
    ).finally(() => {
      reading = false;
      if (!cancelled && readAgain) {
        readAgain = false;
        refresh();
      }
    });
  };

  void currentWindow.onResized(refresh).then((fn) => {
    if (cancelled) fn();
    else {
      unlisten = fn;
      refresh();
    }
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Client-only contract for shell staging and activation; Rust owns the mechanics. */
export const SHELL_RELEASE_STATE_COMMAND = "get_shell_release_state";
export const SHELL_RESTART_COMMAND = "restart_to_staged_shell";
export const SHELL_UPDATE_STAGED_EVENT = "comma-shell-update-staged";

export async function readShellReleaseState(
  win: DesktopShellWindow | undefined = defaultWindow(),
): Promise<ShellReleaseState | null> {
  const invoke = tauriGlobal(win)?.core?.invoke;
  if (!invoke) return null;
  try {
    const state = await invoke<Record<string, string | null | undefined>>(SHELL_RELEASE_STATE_COMMAND);
    return parseShellReleaseState(state);
  } catch {
    return null;
  }
}

export async function restartToStagedShell(
  win: DesktopShellWindow | undefined = defaultWindow(),
): Promise<boolean> {
  const invoke = tauriGlobal(win)?.core?.invoke;
  if (!invoke) return false;
  try {
    await invoke<null>(SHELL_RESTART_COMMAND);
    return true;
  } catch {
    return false;
  }
}

/** Reads staged state once, then follows the laptop stager's Tauri event. */
export function installShellReleaseBridge(
  onState: (state: ShellReleaseState) => void,
  win: DesktopShellWindow | undefined = defaultWindow(),
): () => void {
  const tauri = tauriGlobal(win);
  if (!tauri?.core) return () => undefined;

  let cancelled = false;
  let unlisten: TauriListenUnlisten | undefined;
  void readShellReleaseState(win).then((state) => {
    if (!cancelled && state) onState(state);
  });
  void tauri.event.listen(SHELL_UPDATE_STAGED_EVENT, (event) => {
    if (cancelled || typeof event.payload === "string") return;
    const state = parseShellReleaseState(event.payload);
    if (state) onState(state);
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/**
 * Native menu accelerators emit `imsg-shortcut` with a CommandId payload.
 * No-ops outside Tauri so the PWA bundle is unaffected.
 */
export function installNativeMenuBridge(
  win: DesktopShellWindow | undefined = defaultWindow(),
): () => void {
  const tauri = tauriGlobal(win);
  if (!tauri) return () => undefined;

  let cancelled = false;
  let unlisten: TauriListenUnlisten | undefined;
  void tauri.event
    .listen("imsg-shortcut", (event) => {
      if (typeof event.payload !== "string") return;
      const id = event.payload;
      if (!isCommandId(id)) return;
      const command: CommandId = id;
      const handled = runCommand(command, "native-menu");
      if (command === "navigation.close" && !handled) closeDesktopWindow(win);
    })
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
