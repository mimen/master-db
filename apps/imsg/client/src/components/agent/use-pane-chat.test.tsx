import { expect, mock, test } from "bun:test";

if (process.env.COMMA_PANE_CHAT_TEST_CHILD !== "1") {
  test("the pane picks, holds and switches its chat, and marks finished turns seen while watched", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir, env: { ...process.env, COMMA_PANE_CHAT_TEST_CHILD: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const { JSDOM } = await import("jsdom");
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

  let focused = true;
  dom.window.document.hasFocus = () => focused;
  const marked: string[] = [];
  mock.module("expo-router", () => ({ router: { push: () => undefined } }));
  mock.module("react-native", () => ({ Platform: { OS: "web" }, AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) } }));
  mock.module("@/hooks/use-layout-mode", () => ({ useLayoutMode: () => ({ wide: true, width: 1440 }) }));
  const client = { mutation: async (_name: unknown, args: { chatId: string }) => { marked.push(args.chatId); } };
  mock.module("convex/react", () => ({ useConvex: () => client }));
  const { usePaneSelection, useMarkSeen } = await import("./use-pane-chat");
  const { onOpenAgentPane, openAgentPane, takeRequestedAgentChat } = await import("@/lib/agent-pane");
  type Summary = Parameters<typeof useMarkSeen>[0] & {};

  const summary = (id: string, state: Summary["state"], extra: Partial<Summary> = {}) =>
    ({ _id: id, state, updatedAt: 1, ...extra }) as Summary;
  let shown: unknown;
  function Probe({ guid, chats, requested }: { guid: string; chats: readonly Summary[] | undefined; requested?: string }) {
    shown = usePaneSelection(guid, requested, chats)[0];
    return null;
  }
  function Watcher({ chat }: { chat: Summary }) {
    useMarkSeen(chat);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  const render = async (element: React.ReactElement) => { await act(async () => { root.render(element); }); };
  // Stands in for the desktop shell, whose listener makes openAgentPane keep the request instead of pushing the route.
  const stopShell = onOpenAgentPane(() => undefined);

  const ready = summary("ready", "idle", { lastTurnEndedAt: 5 });
  const asking = summary("asking", "waiting_input");

  test("a chat requested before the pane mounts beats the most urgent one", async () => {
    openAgentPane("a", "ready");
    await render(createElement(Probe, { key: "a", guid: "a", chats: [asking, ready] }));
    expect(shown).toEqual({ kind: "chat", chatId: "ready" });
  });

  test("the phone route's param is the request", async () => {
    await render(createElement(Probe, { key: "phone", guid: "a", chats: [asking, ready], requested: "ready" }));
    expect(shown).toEqual({ kind: "chat", chatId: "ready" });
  });

  test("with no request the most urgent open chat wins once the list loads, and holds after it stops being the most urgent", async () => {
    await render(createElement(Probe, { key: "b", guid: "b", chats: undefined }));
    expect(shown).toBeUndefined();
    await render(createElement(Probe, { key: "b", guid: "b", chats: [ready, asking] }));
    expect(shown).toEqual({ kind: "chat", chatId: "asking" });
    await render(createElement(Probe, { key: "b", guid: "b", chats: [ready, { ...asking, state: "idle" }] }));
    expect(shown).toEqual({ kind: "chat", chatId: "asking" });
  });

  test("no open chat means a new chat", async () => {
    await render(createElement(Probe, { key: "c", guid: "c", chats: [summary("old", "idle", { settledAt: 3 })] }));
    expect(shown).toEqual({ kind: "new" });
  });

  test("a request for the open conversation switches the mounted pane; one for another conversation waits for its pane", async () => {
    await render(createElement(Probe, { key: "d", guid: "d", chats: [asking, ready] }));
    expect(shown).toEqual({ kind: "chat", chatId: "asking" });
    await act(async () => openAgentPane("d", "ready"));
    expect(shown).toEqual({ kind: "chat", chatId: "ready" });
    await act(async () => openAgentPane("e", "asking"));
    expect(shown).toEqual({ kind: "chat", chatId: "ready" });
    expect(takeRequestedAgentChat("e")).toBe("asking");
  });

  test("a finished turn is marked seen once while the window is watched, and waits while it is not", async () => {
    await render(createElement(Watcher, { chat: ready }));
    await render(createElement(Watcher, { chat: ready }));
    expect(marked).toEqual(["ready"]);
    await render(createElement(Watcher, { chat: { ...ready, seenAt: 6 } }));
    expect(marked).toEqual(["ready"]);
    focused = false;
    await act(async () => { dom.window.dispatchEvent(new dom.window.FocusEvent("blur")); });
    await render(createElement(Watcher, { chat: { ...ready, seenAt: 6, lastTurnEndedAt: 9 } }));
    expect(marked).toEqual(["ready"]);
    focused = true;
    await act(async () => { dom.window.dispatchEvent(new dom.window.FocusEvent("focus")); });
    expect(marked).toEqual(["ready", "ready"]);
    stopShell();
    await act(async () => root.unmount());
    dom.window.close();
  });
}
