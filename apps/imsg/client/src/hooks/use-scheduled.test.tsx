import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { GenericId } from "convex/values";
import type { commandReceipt, CommaScheduledDoc } from "../../../../../convex/schema/comma/validators";
import { runCommandVia, type ResultCommandClient } from "../lib/convex-commands";
import type { useScheduledState as StateHook, UseScheduledResult } from "./use-scheduled";

let useScheduledState: typeof StateHook;
const bundlePath = join(import.meta.dir, `.scheduled-hook-${process.pid}.js`);

beforeAll(async () => {
  // Compile the native import to the real web Platform adapter; React and Convex
  // stay external so injected dependencies and the test use the same runtimes.
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "use-scheduled.ts")], target: "bun",
    external: ["react", "convex/*"],
    define: { "process.env.EXPO_PUBLIC_CONVEX_URL": JSON.stringify("https://scheduled-test.convex.cloud") },
    plugins: [{ name: "web-platform", setup(build) {
      build.onResolve({ filter: /^react-native$/ }, () => ({ path: "platform", namespace: "scheduled-platform" }));
      build.onLoad({ filter: /.*/, namespace: "scheduled-platform" }, () => ({ loader: "js",
        contents: `export { default as Platform } from ${JSON.stringify(join(import.meta.dir, "../../node_modules/react-native-web/dist/exports/Platform/index.js"))};` }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  await Bun.write(bundlePath, built.outputs[0]);
  ({ useScheduledState } = await import(bundlePath));
});
afterAll(async () => { await rm(bundlePath, { force: true }); });

const rows: CommaScheduledDoc[] = [{ _id: "scheduled-7" as GenericId<"comma_scheduled">,
  _creationTime: 1, bbId: 7, conversationId: "chat" as GenericId<"comma_conversations">,
  chatGuid: "iMessage;-;alex", text: "later", sendAt: 2_000, status: "pending", updatedAt: 1 }];

function commands() {
  let snapshot: typeof commandReceipt.type | undefined;
  let callback: (() => void) | undefined;
  let subscribed!: () => void;
  const ready = new Promise<void>((resolve) => { subscribed = resolve; });
  const client: ResultCommandClient = {
    query: async () => ({ _id: "chat" }), mutation: async () => "command-1",
    watchQuery: () => ({ localQueryResult: () => snapshot, onUpdate: (listener) => {
      callback = listener; subscribed(); return () => { callback = undefined; };
    } }),
  };
  return { ready, actions: {
    cancelScheduled: (id: number) => runCommandVia(client, rows[0]!.chatGuid, { kind: "cancelScheduled", bbId: id }),
    sendScheduledNow: (id: number) => runCommandVia(client, rows[0]!.chatGuid, { kind: "sendScheduledNow", bbId: id }),
    updateScheduled: async () => { throw new Error("unused"); },
  }, finish: (status: "failed" | "unknown" | "sent", kind: "cancelScheduled" | "sendScheduledNow") => {
    snapshot = { commandId: "command-1" as GenericId<"comma_outbox">, clientKey: "key", status, updatedAt: 1,
      ...(status === "sent" ? { result: { kind, ok: true } } : { error: "scheduler unavailable" }) };
    callback?.();
  } };
}

for (const kind of ["cancelScheduled", "sendScheduledNow"] as const) {
  for (const status of ["failed", "unknown", "sent"] as const) {
    test(`${kind} hides optimistically and ${status === "sent" ? "stays hidden on success" : `rolls back on ${status}`}`, async () => {
      const dom = new JSDOM("<div id='scheduled-root'></div>");
      const previous = { window: globalThis.window, document: globalThis.document,
        act: Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT") };
      Object.assign(globalThis, { window: dom.window, document: dom.window.document });
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
      const h = commands();
      let hook!: UseScheduledResult;
      function Scheduled() {
        hook = useScheduledState(rows, [], h.actions);
        return createElement("div", null, hook.items.map((item) => item.text).join(","));
      }
      const container = document.getElementById("scheduled-root")!;
      const root = createRoot(container);
      try {
        await act(async () => { root.render(createElement(Scheduled)); });
        expect(container.textContent).toBe("later");
        let result: Promise<unknown> | undefined;
        await act(async () => {
          if (kind === "cancelScheduled") hook.cancel(7);
          else result = hook.sendNow(7).catch((error: unknown) => error);
          await h.ready;
        });
        expect(container.textContent).toBe("");
        await act(async () => { h.finish(status, kind); await result; });
        expect(container.textContent).toBe(status === "sent" ? "" : "later");
      } finally {
        await act(async () => { root.unmount(); });
        Object.assign(globalThis, { window: previous.window, document: previous.document });
        Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previous.act);
        dom.window.close();
      }
    });
  }
}
