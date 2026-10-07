import { describe, expect, test } from "bun:test";
import { enqueueVia, sendMovesSidebar, type CommandClient } from "./convex-commands";

function client(resolved: { _id: string } | null) {
  const calls: { kind: string; args: unknown }[] = [];
  const fake: CommandClient = {
    query: (_ref, args) => {
      calls.push({ kind: "query", args });
      return Promise.resolve(resolved);
    },
    mutation: (_ref, args) => {
      calls.push({ kind: "mutation", args });
      return Promise.resolve("outbox-1");
    },
  };
  return { fake, calls };
}

describe("enqueueVia", () => {
  test("queues the command on the resolved conversation", async () => {
    const { fake, calls } = client({ _id: "conv-1" });
    await enqueueVia(fake, "iMessage;-;+15550001111", { kind: "pin", value: true });
    const mutation = calls.find((call) => call.kind === "mutation")?.args as { conversationId: string; payload: unknown; clientKey: string };
    expect(mutation.conversationId).toBe("conv-1");
    expect(mutation.payload).toEqual({ kind: "pin", value: true });
    expect(mutation.clientKey.startsWith("command-")).toBe(true);
  });

  test("rejects an unmirrored chat without sending via REST", async () => {
    const { fake, calls } = client(null);
    await expect(enqueueVia(fake, "SMS;-;+15550009999", { kind: "settle" })).rejects.toThrow("Conversation is not mirrored yet");
    expect(calls.some((call) => call.kind === "mutation")).toBe(false);
  });

  test("propagates a rejected outbox write", async () => {
    const { fake } = client({ _id: "conv-1" });
    fake.mutation = async () => { throw new Error("outbox unavailable"); };
    await expect(enqueueVia(fake, "chat", { kind: "markRead" })).rejects.toThrow("outbox unavailable");
  });
});

function subscriptionClient(initial?: import("./command-results").CommandReceipt | null, synchronous = false) {
  type Receipt = import("./command-results").CommandReceipt;
  type ResultClient = import("./convex-commands").ResultCommandClient;
  const callbacks = new Set<() => void>();
  const calls: { kind: string; args: unknown }[] = [];
  let snapshot = initial;
  let readError: Error | null = null;
  let cleanupCount = 0;
  let ready!: () => void;
  const subscribed = new Promise<void>((resolve) => { ready = resolve; });
  const fake: ResultClient = {
    query: async (_ref, args) => { calls.push({ kind: "query", args }); return { _id: "conv-1" }; },
    mutation: async (_ref, args) => { calls.push({ kind: "mutation", args }); return "command-1"; },
    watchQuery: (_ref, args) => {
      calls.push({ kind: "watch", args });
      return {
        onUpdate: (callback) => {
          callbacks.add(callback); ready();
          if (synchronous) callback();
          return () => { cleanupCount++; callbacks.delete(callback); };
        },
        localQueryResult: () => { if (readError) throw readError; return snapshot; },
      };
    },
  };
  return { fake, calls, subscribed, cleanupCount: () => cleanupCount, listeners: () => callbacks.size,
    push: (value: Receipt | null) => { snapshot = value; for (const callback of callbacks) callback(); },
    failRead: (error: Error) => { readError = error; for (const callback of callbacks) callback(); },
  };
}
function receipt(status: import("./command-results").CommandReceipt["status"], result?: import("./command-results").CommandResult): import("./command-results").CommandReceipt {
  return { commandId: "command-1" as import("convex/values").GenericId<"comma_outbox">, clientKey: "key-1", status, updatedAt: 1, ...(result ? { result } : {}) };
}

import { getFunctionName } from "convex/server";
import { runCommandVia } from "./convex-commands";
import { CommandExecutionError, CommandResultError, UnknownCommandError } from "./command-results";
import { commaApi, commaOutbox } from "./convex-api";

describe("runCommandVia", () => {
  test("subscribes through pending and claimed to the typed terminal result and unsubscribes", async () => {
    const h = subscriptionClient();
    const pending = runCommandVia(h.fake, "chat", { kind: "pin", value: true });
    await h.subscribed;
    h.push(receipt("pending")); h.push(receipt("claimed"));
    expect(h.cleanupCount()).toBe(0);
    h.push(receipt("sent", { kind: "pin", ok: true }));
    const result = await pending;
    expect(result).toEqual({ kind: "pin", ok: true });
    expect(result.ok).toBe(true); // Static inference retains the pin result shape.
    expect(h.calls.find((call) => call.kind === "watch")?.args).toEqual({ commandId: "command-1" });
    expect(h.listeners()).toBe(0);
    expect(h.cleanupCount()).toBe(1);
  });

  test("cached and synchronous terminal results both resolve without leaking subscriptions", async () => {
    for (const synchronous of [false, true]) {
      const h = subscriptionClient(receipt("sent", { kind: "clearSuggestionLearning", ok: true }), synchronous);
      expect(await runCommandVia(h.fake, null, { kind: "clearSuggestionLearning" })).toEqual({ kind: "clearSuggestionLearning", ok: true });
      expect(h.calls.some((call) => call.kind === "query")).toBe(false);
      expect(h.calls.find((call) => call.kind === "mutation")?.args).not.toHaveProperty("conversationId");
      expect(h.listeners()).toBe(0);
      expect(h.cleanupCount()).toBe(1);
    }
  });

  test("non-global kinds require a chat before making any request", async () => {
    const h = subscriptionClient();
    await expect(runCommandVia(h.fake, null, { kind: "identify" })).rejects.toThrow("requires a chat");
    expect(h.calls).toEqual([]);
  });

  test("duplicate client keys subscribe to the existing command result", async () => {
    const h = subscriptionClient(receipt("sent", { kind: "pin", ok: true }));
    const options = { clientKey: "same-logical-command" };
    await runCommandVia(h.fake, "chat", { kind: "pin", value: true }, options);
    await runCommandVia(h.fake, "chat", { kind: "pin", value: true }, options);
    expect(h.calls.filter((call) => call.kind === "mutation").map((call) => (call.args as { clientKey: string }).clientKey)).toEqual([options.clientKey, options.clientKey]);
    expect(h.calls.filter((call) => call.kind === "watch").map((call) => call.args)).toEqual([{ commandId: "command-1" }, { commandId: "command-1" }]);
  });

  test("failed results reject with the bridge error; unknown results use a distinct error", async () => {
    for (const status of ["failed", "unknown"] as const) {
      const h = subscriptionClient({ ...receipt(status), error: "bridge stopped" });
      const error = await runCommandVia(h.fake, "chat", { kind: "pin", value: true }).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(status === "unknown" ? UnknownCommandError : CommandExecutionError);
      expect((error as Error).message).toBe("bridge stopped");
      expect(String((error as CommandExecutionError).commandId)).toBe("command-1");
      expect(h.listeners()).toBe(0);
    }
  });

  test("missing and mismatched results reject as protocol errors", async () => {
    for (const result of [undefined, { kind: "mute" as const, ok: true as const }]) {
      const h = subscriptionClient(receipt("sent", result));
      await expect(runCommandVia(h.fake, "chat", { kind: "pin", value: true })).rejects.toBeInstanceOf(CommandResultError);
      expect(h.listeners()).toBe(0);
    }
  });

  test("missing commands and subscription errors reject and clean up", async () => {
    const missing = subscriptionClient(null);
    await expect(runCommandVia(missing.fake, "chat", { kind: "pin", value: true })).rejects.toThrow("Command not found");
    const h = subscriptionClient();
    const pending = runCommandVia(h.fake, "chat", { kind: "pin", value: true });
    await h.subscribed;
    h.failRead(new Error("Unauthorized"));
    await expect(pending).rejects.toThrow("Unauthorized");
    expect(h.listeners()).toBe(0);
  });

  test("abort cancels observation and a pre-aborted call never enqueues", async () => {
    const h = subscriptionClient();
    const controller = new AbortController();
    const pending = runCommandVia(h.fake, "chat", { kind: "pin", value: true }, { signal: controller.signal });
    await h.subscribed;
    controller.abort(new Error("cancel waiting"));
    await expect(pending).rejects.toThrow("cancel waiting");
    expect(h.listeners()).toBe(0);
    const before = h.calls.length;
    await expect(runCommandVia(h.fake, "chat", { kind: "pin", value: true }, { signal: controller.signal })).rejects.toThrow("cancel waiting");
    expect(h.calls.length).toBe(before);
  });

  test("public foundation references point to the outbox module", () => {
    expect(getFunctionName(commaApi.getCommand)).toBe("comma/outbox:getCommand");
    expect(getFunctionName(commaOutbox.getCommand)).toBe("comma/outbox:getCommand");
    expect(getFunctionName(commaApi.enqueue)).toBe("comma/outbox:enqueue");
  });
});

test("hook tracks command state and releases a pending subscription on unmount", async () => {
  const { JSDOM } = await import("jsdom");
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useRunCommand } = await import("./convex-commands");
  const dom = new JSDOM("<div id='root'></div>");
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Reflect.get(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const h = subscriptionClient();
  let state!: ReturnType<typeof useRunCommand>;
  function Probe() { state = useRunCommand(h.fake); return null; }
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    await act(async () => { root.render(createElement(Probe)); });
    let pending!: ReturnType<typeof state.runCommand>;
    await act(async () => { pending = state.runCommand("chat", { kind: "pin", value: true }); await h.subscribed; });
    expect(state.isPending).toBe(true);
    await act(async () => { h.push(receipt("sent", { kind: "pin", ok: true })); await pending; });
    expect(state.isPending).toBe(false);
    expect(state.result).toEqual({ kind: "pin", ok: true });
    // The next observation stays pending until unmount cancels just its subscription.
    h.push(receipt("pending"));
    let canceled!: Promise<unknown>;
    await act(async () => {
      canceled = state.runCommand("chat", { kind: "pin", value: false }).catch((cause: unknown) => cause);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(h.listeners()).toBe(1);
    await act(async () => { root.unmount(); await canceled; });
    expect(h.listeners()).toBe(0);
    expect(await canceled).toBeInstanceOf(Error);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(globalThis, key);
      else Reflect.set(globalThis, key, value);
    }
  }
});

describe("sendMovesSidebar", () => {
  type Row = { _id: string; lastMessageAt: number; lastMessage?: { guid: string; text: string }; flags: { unresponded: boolean; waiting: boolean } };
  function store(page: Row[]) {
    const pages = [{ args: { paginationOpts: { numItems: 25, cursor: null } }, value: { page, isDone: false, continueCursor: "c" } }];
    return {
      pages,
      getAllQueries: () => pages,
      getQuery: () => undefined,
      setQuery: (_ref: unknown, args: unknown, value: (typeof pages)[number]["value"]) => {
        const hit = pages.find((p) => p.args === args);
        if (hit) hit.value = value;
      },
    };
  }
  const row = (id: string): Row => ({ _id: id, lastMessageAt: 1, lastMessage: { guid: "old", text: "old" }, flags: { unresponded: true, waiting: false } });

  test("a send puts its text, time and Waiting on its own row and leaves the rest", () => {
    const local = store([row("a"), row("b")]);
    sendMovesSidebar(local as never, { clientKey: "k", conversationId: "b" as never, payload: { kind: "send", text: "hi" } });
    const [a, b] = local.pages[0].value.page;
    expect(a).toEqual(row("a"));
    expect(b.lastMessage).toMatchObject({ guid: "temp-k", text: "hi" });
    expect(b.lastMessageAt).toBeGreaterThan(1);
    expect(b.flags).toEqual({ unresponded: false, waiting: true });
  });

  test("other commands leave the sidebar alone", () => {
    const local = store([row("a")]);
    sendMovesSidebar(local as never, { clientKey: "k", conversationId: "a" as never, payload: { kind: "pin", value: true } });
    expect(local.pages[0].value.page).toEqual([row("a")]);
  });
});
