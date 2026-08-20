import { runCommand } from "./keyboard/controller";
import { isCommandId } from "./keyboard/registry";
import type { CommandId } from "./keyboard/types";

/**
 * Space reserved at the left of SidebarChrome for overlay traffic lights.
 * Lights sit at (16, 20); three 12px buttons with 8px gaps need ~72px,
 * plus a gap before the wordmark.
 */
export const DESKTOP_TRAFFIC_LIGHT_INSET = 80;

type TauriListenUnlisten = () => void;

type TauriGlobal = {
  event: {
    listen: (
      event: string,
      handler: (event: { payload: string }) => void,
    ) => Promise<TauriListenUnlisten>;
  };
  window: {
    getCurrentWindow: () => { close: () => Promise<void> };
  };
};

export type DesktopShellWindow = {
  __TAURI__?: TauriGlobal;
  __IMSG_NATIVE_SHELL__?: boolean;
};

function defaultWindow(): DesktopShellWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window as Window & DesktopShellWindow;
}

/** True when the page is running inside the Tauri desktop shell. */
export function isDesktopShell(win: DesktopShellWindow | undefined = defaultWindow()): boolean {
  return win !== undefined && (win.__TAURI__ !== undefined || win.__IMSG_NATIVE_SHELL__ === true);
}

function tauriGlobal(win: DesktopShellWindow | undefined = defaultWindow()): TauriGlobal | null {
  return win?.__TAURI__ ?? null;
}

export function closeDesktopWindow(win: DesktopShellWindow | undefined = defaultWindow()): void {
  const tauri = tauriGlobal(win);
  if (!tauri) return;
  void tauri.window.getCurrentWindow().close();
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
      const id: string = event.payload;
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
