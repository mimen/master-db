import { afterEach, describe, expect, test } from "bun:test";

import { desktopFrame } from "./desktop-frame";
import {
  installNativeMenuBridge,
  isDesktopShell,
  type DesktopShellWindow,
} from "./desktop-shell";
import { setKeyboardRuntime } from "./keyboard/controller";

afterEach(() => setKeyboardRuntime(null));

describe("isDesktopShell", () => {
  test("false without a window or without __TAURI__", () => {
    expect(isDesktopShell(undefined)).toBe(false);
    expect(isDesktopShell({})).toBe(false);
  });

  test("true when the Tauri global is present", () => {
    const win: DesktopShellWindow = {
      __TAURI__: {
        event: { listen: async () => () => undefined },
        window: { getCurrentWindow: () => ({ close: async () => undefined }) },
      },
    };
    expect(isDesktopShell(win)).toBe(true);
  });
});

describe("desktopFrame", () => {
  const theme = {
    background: "#ffffff",
    desk: "#e6e7ee",
    cardBorder: "rgba(0,0,0,0.08)",
    divider: "#E5E5EA",
  };

  test("web keeps the desk, padding, and floating cards", () => {
    const frame = desktopFrame(theme, false);
    expect(frame.shell).toBe(false);
    expect(frame.split.padding).toBe(10);
    expect(frame.split.gap).toBe(10);
    expect(frame.split.backgroundColor).toBe(theme.desk);
    expect(frame.pane.borderRadius).toBe(14);
    expect(frame.pane.shadowRadius).toBe(22);
    expect(frame.listPane.borderRightWidth).toBeUndefined();
  });

  test("shell is edge-to-edge with a hairline list divider", () => {
    const frame = desktopFrame(theme, true);
    expect(frame.split.padding).toBe(0);
    expect(frame.split.gap).toBe(0);
    expect(frame.split.backgroundColor).toBe(theme.background);
    expect(frame.pane.borderRadius).toBeUndefined();
    expect(frame.pane.shadowRadius).toBeUndefined();
    expect(frame.listPane.borderRightWidth).toBeGreaterThan(0);
    expect(frame.listPane.width).toBe(380);
  });
});

describe("native menu bridge", () => {
  test("dispatches a CommandId payload through runCommand", async () => {
    let heard = "";
    setKeyboardRuntime({
      openPalette: () => {
        heard = "palette.open";
      },
      openNewMessage: () => undefined,
      openHelp: () => undefined,
      moveSelection: () => undefined,
      activateSelection: () => undefined,
      findInConversation: () => undefined,
      archiveSelected: () => undefined,
      markUnreadSelected: () => undefined,
      toggleDetails: () => undefined,
      focusListSearch: () => undefined,
      undoLast: () => undefined,
      escape: () => undefined,
      closePanel: () => false,
    });

    let handler: ((event: { payload: string }) => void) | undefined;
    const win: DesktopShellWindow = {
      __TAURI__: {
        event: {
          listen: async (_event, fn) => {
            handler = fn;
            return () => undefined;
          },
        },
        window: { getCurrentWindow: () => ({ close: async () => undefined }) },
      },
    };
    const uninstall = installNativeMenuBridge(win);
    await Promise.resolve();
    handler?.({ payload: "palette.open" });
    expect(heard).toBe("palette.open");
    uninstall();
  });

  test("navigation.close falls through to the window when the panel ladder is empty", async () => {
    let closed = false;
    setKeyboardRuntime({
      openPalette: () => undefined,
      openNewMessage: () => undefined,
      openHelp: () => undefined,
      moveSelection: () => undefined,
      activateSelection: () => undefined,
      findInConversation: () => undefined,
      archiveSelected: () => undefined,
      markUnreadSelected: () => undefined,
      toggleDetails: () => undefined,
      focusListSearch: () => undefined,
      undoLast: () => undefined,
      escape: () => undefined,
      closePanel: () => false,
    });
    let handler: ((event: { payload: string }) => void) | undefined;
    const win: DesktopShellWindow = {
      __TAURI__: {
        event: {
          listen: async (_event, fn) => {
            handler = fn;
            return () => undefined;
          },
        },
        window: {
          getCurrentWindow: () => ({
            close: async () => {
              closed = true;
            },
          }),
        },
      },
    };
    installNativeMenuBridge(win);
    await Promise.resolve();
    handler?.({ payload: "navigation.close" });
    expect(closed).toBe(true);
  });
});
