import { describe, expect, test } from "bun:test";

import { projectDesktopRoute } from "./route";
import {
  createInitialDesktopShellState,
  INITIAL_DESKTOP_SHELL_STATE,
  reduceDesktopShell,
} from "./reducer";
import type {
  DesktopRouteProjection,
  DesktopRouteError,
  DesktopShellState,
  Result,
} from "./types";

function route(
  pathname: string,
  params: Parameters<typeof projectDesktopRoute>[1] = {},
  previousWorkspace?: Parameters<typeof projectDesktopRoute>[2],
): DesktopRouteProjection {
  const result: Result<DesktopRouteProjection, DesktopRouteError> = projectDesktopRoute(
    pathname,
    params,
    previousWorkspace,
  );
  if (!result.ok) throw new Error(`Projection failed: ${result.error.kind}`);
  return result.value;
}

function dispatchRoute(
  state: DesktopShellState,
  pathname: string,
  params: Parameters<typeof projectDesktopRoute>[1] = {},
): DesktopShellState {
  return reduceDesktopShell(state, {
    type: "route/committed",
    route: route(pathname, params, state.activeWorkspace),
  });
}

describe("desktop shell reducer", () => {
  test("initializes cold direct routes atomically", () => {
    const state = createInitialDesktopShellState(
      route("/chat-info", { guid: "chat-1", name: "Ada" }),
    );
    expect(state.activeWorkspace).toBe("messages");
    expect(state.messages.selection).toEqual({
      guid: "chat-1",
      name: "Ada",
      intent: "reply",
    });
    expect(state.utility).toEqual({
      kind: "chat-info",
      workspace: "messages",
      guid: "chat-1",
    });
    expect(state.shadow).toBeNull();
  });

  test("preserves each workspace selection and Messages filters across switches", () => {
    let state = reduceDesktopShell(INITIAL_DESKTOP_SHELL_STATE, {
      type: "messages/filters-changed",
      filters: { state: "waiting", type: "group" },
    });
    state = reduceDesktopShell(state, {
      type: "messages/chat-selected",
      selection: { guid: "chat-1", name: "Group", intent: "preview" },
    });
    state = dispatchRoute(state, "/contacts");
    state = reduceDesktopShell(state, {
      type: "contacts/person-selected",
      selection: { address: "+1555", name: "Ada" },
    });
    state = dispatchRoute(state, "/");

    expect(state.activeWorkspace).toBe("messages");
    expect(state.messages.filters).toEqual({ state: "waiting", type: "group" });
    expect(state.messages.selection).toEqual({
      guid: "chat-1",
      name: "Group",
      intent: "preview",
    });
    expect(state.contacts.selection).toEqual({ address: "+1555", name: "Ada" });

    state = dispatchRoute(state, "/contacts");
    expect(state.contacts.selection).toEqual({ address: "+1555", name: "Ada" });
  });

  test("clears the selected chat and its scoped panes atomically", () => {
    let state = reduceDesktopShell(INITIAL_DESKTOP_SHELL_STATE, {
      type: "messages/chat-selected",
      selection: { guid: "chat-1", intent: "reply" },
    });
    state = reduceDesktopShell(state, {
      type: "utility/toggled",
      utility: { kind: "chat-info", workspace: "messages", guid: "chat-1" },
    });
    state = reduceDesktopShell(state, { type: "shadow/toggled", chatGuid: "chat-1" });
    state = reduceDesktopShell(state, { type: "messages/chat-cleared" });

    expect(state.messages.selection).toBeNull();
    expect(state.utility).toBeNull();
    expect(state.shadow).toBeNull();
  });

  test("keeps app-global utilities open across every workspace and inbox destination", () => {
    let state = reduceDesktopShell(INITIAL_DESKTOP_SHELL_STATE, {
      type: "utility/toggled",
      utility: { kind: "scheduled", workspace: "messages" },
    });
    state = dispatchRoute(state, "/contacts");
    expect(state.utility).toEqual({ kind: "scheduled", workspace: "contacts" });

    state = dispatchRoute(state, "/");
    expect(state.utility).toEqual({ kind: "scheduled", workspace: "messages" });

    state = reduceDesktopShell(state, {
      type: "messages/filters-changed",
      filters: { state: "waiting", type: "all" },
    });
    expect(state.utility).toEqual({ kind: "scheduled", workspace: "messages" });
  });

  test("closes route overlays, transient overlays, and shadow on workspace switches", () => {
    let state = reduceDesktopShell(INITIAL_DESKTOP_SHELL_STATE, {
      type: "utility/toggled",
      utility: { kind: "settings", workspace: "messages" },
    });
    state = reduceDesktopShell(state, {
      type: "overlay/opened",
      overlay: { kind: "keyboard-help" },
    });
    state = {
      ...state,
      routeOverlay: { kind: "search", query: "Ada" },
      shadow: null,
    };
    state = reduceDesktopShell(state, {
      type: "shadow/toggled",
      chatGuid: "chat-1",
    });
    expect(state.utility).toBeNull();
    expect(state.shadow).toEqual({ chatGuid: "chat-1" });

    state = dispatchRoute(state, "/contacts");
    expect(state.utility).toBeNull();
    expect(state.routeOverlay).toBeNull();
    expect(state.transientOverlay).toBeNull();
    expect(state.shadow).toBeNull();
  });

  test("applies route selection and route surface in one transition", () => {
    const before: DesktopShellState = {
      ...INITIAL_DESKTOP_SHELL_STATE,
      shadow: { chatGuid: "old-chat" },
      transientOverlay: { kind: "command-palette", compose: false },
    };
    const after = dispatchRoute(before, "/chat-info", {
      guid: "chat-2",
      name: "Grace",
    });

    expect(after.messages.selection).toEqual({
      guid: "chat-2",
      name: "Grace",
      intent: "reply",
    });
    expect(after.utility).toEqual({
      kind: "chat-info",
      workspace: "messages",
      guid: "chat-2",
    });
    expect(after.shadow).toBeNull();
  });

  test("root workspace commits retain selection while closing route-owned surfaces", () => {
    let state = createInitialDesktopShellState(
      route("/chat/chat-1", { name: "Ada" }),
    );
    state = dispatchRoute(state, "/search", { query: "invoice" });
    expect(state.routeOverlay).toEqual({ kind: "search", query: "invoice" });
    state = dispatchRoute(state, "/");
    expect(state.messages.selection?.guid).toBe("chat-1");
    expect(state.routeOverlay).toBeNull();
  });

  test("utility and shadow are mutually exclusive and independently toggle", () => {
    let state = reduceDesktopShell(INITIAL_DESKTOP_SHELL_STATE, {
      type: "shadow/toggled",
      chatGuid: "chat-1",
    });
    expect(state.shadow).toEqual({ chatGuid: "chat-1" });

    state = reduceDesktopShell(state, {
      type: "utility/toggled",
      utility: { kind: "scheduled", workspace: "messages" },
    });
    expect(state.shadow).toBeNull();
    expect(state.utility).toEqual({ kind: "scheduled", workspace: "messages" });

    state = reduceDesktopShell(state, {
      type: "shadow/toggled",
      chatGuid: "chat-1",
    });
    expect(state.utility).toBeNull();
    expect(state.shadow).toEqual({ chatGuid: "chat-1" });

    state = reduceDesktopShell(state, {
      type: "shadow/toggled",
      chatGuid: "chat-1",
    });
    expect(state.shadow).toBeNull();
  });

  test("toggles only an identical utility and ignores stale overlay closes", () => {
    let state = reduceDesktopShell(INITIAL_DESKTOP_SHELL_STATE, {
      type: "utility/toggled",
      utility: { kind: "chat-info", workspace: "messages", guid: "chat-1" },
    });
    state = reduceDesktopShell(state, {
      type: "utility/toggled",
      utility: { kind: "chat-info", workspace: "messages", guid: "chat-2" },
    });
    expect(state.utility).toEqual({
      kind: "chat-info",
      workspace: "messages",
      guid: "chat-2",
    });
    state = reduceDesktopShell(state, {
      type: "utility/toggled",
      utility: { kind: "chat-info", workspace: "messages", guid: "chat-2" },
    });
    expect(state.utility).toBeNull();

    state = reduceDesktopShell(state, {
      type: "overlay/opened",
      overlay: { kind: "command-palette", compose: true },
    });
    expect(
      reduceDesktopShell(state, { type: "overlay/closed", kind: "keyboard-help" }),
    ).toBe(state);
    expect(
      reduceDesktopShell(state, { type: "overlay/closed", kind: "command-palette" })
        .transientOverlay,
    ).toBeNull();
  });
});
