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

  test("true when the native-shell init flag is set", () => {
    expect(isDesktopShell({ __IMSG_NATIVE_SHELL__: true })).toBe(true);
  });
});

describe("desktopFrame", () => {
  const theme = {
    background: "#ffffff",
    divider: "#E5E5EA",
  };

  test("wide split is flush with hairline pane dividers", () => {
    const frame = desktopFrame(theme);
    expect(frame.split.padding).toBeUndefined();
    expect(frame.split.gap).toBeUndefined();
    expect(frame.split.backgroundColor).toBe(theme.background);
    expect(frame.pane.borderRadius).toBeUndefined();
    expect(frame.listPane.borderRightWidth).toBe(1);
    expect(frame.listPane.width).toBe(380);
    expect(frame.auxPane.borderLeftWidth).toBe(1);
    expect(frame.auxPane.width).toBe(330);
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
