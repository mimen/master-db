import { describe, expect, test } from "bun:test";
import type { ConversationId } from "@shared/types";

import { INITIAL_DESKTOP_SHELL_STATE } from "@/lib/desktop-coordinator/reducer";

import { createDesktopShellStore } from "./desktop-shell-context";

describe("desktop shell store", () => {
  test("notifies readers only when an action changes the state", () => {
    const store = createDesktopShellStore(INITIAL_DESKTOP_SHELL_STATE);
    let notified = 0;
    const stop = store.subscribe(() => notified++);
    store.dispatch({ type: "utility/closed" });
    expect(notified).toBe(0);
    expect(store.getState()).toBe(INITIAL_DESKTOP_SHELL_STATE);
    store.dispatch({ type: "utility/toggled", utility: { kind: "settings", workspace: "messages" } });
    expect(notified).toBe(1);
    expect(store.getState().utility).toEqual({ kind: "settings", workspace: "messages" });
    stop();
    store.dispatch({
      type: "messages/chat-selected",
      selection: { conversationId: "chat-1" as ConversationId, intent: "reply" },
    });
    expect(notified).toBe(1);
  });
});
