import { expect, test } from "bun:test";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { JSDOM } from "jsdom";
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { RETRY_DELAYS_MS, useRetryingPaginatedQuery } from "./retrying-query";

type Row = { _id: string };
const list = makeFunctionReference<"query", { paginationOpts: { numItems: number; cursor: string | null } }, {
  page: Row[]; isDone: boolean; continueCursor: string;
}>("comma/queries:listConversations");

class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? createElement("p", null, "crashed") : this.props.children; }
}

test("a failed list page reports failed with the last rows, never throws, and a resubscribe recovers", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  let current: { results: Row[]; status: string; loadMore: () => void } | Error | undefined;
  const listeners = new Set<() => void>();
  let subscriptions = 0;
  const client = {
    logger: { warn: () => undefined },
    watchPaginatedQuery: () => ({
      onUpdate: (callback: () => void) => {
        subscriptions++;
        listeners.add(callback);
        return () => { listeners.delete(callback); };
      },
      localQueryResult: () => { if (current instanceof Error) throw current; return current; },
    }),
  } as unknown as ConvexReactClient;
  const publish = (next: typeof current) => act(async () => { current = next; for (const callback of listeners) callback(); });
  let seen: ReturnType<typeof useRetryingPaginatedQuery<typeof list>> | undefined;
  function Probe() {
    seen = useRetryingPaginatedQuery(list, {}, 25);
    return null;
  }
  const root = createRoot(globalThis.document.getElementById("root")!);
  try {
    await act(async () => { root.render(createElement(ConvexProvider, { client }, createElement(Catch, null, createElement(Probe)))); });
    expect(seen?.status).toBe("LoadingFirstPage");

    await publish({ results: [{ _id: "a" }, { _id: "b" }], status: "Exhausted", loadMore: () => undefined });
    expect(seen).toMatchObject({ results: [{ _id: "a" }, { _id: "b" }], status: "Exhausted", failed: false });

    await publish(new Error("[CONVEX Q(comma/queries:listConversations)] Server Error: too many system operations"));
    expect(globalThis.document.body.textContent).not.toContain("crashed");
    expect(seen).toMatchObject({ results: [{ _id: "a" }, { _id: "b" }], failed: true });
    expect(subscriptions).toBe(1);

    current = { results: [{ _id: "c" }, { _id: "a" }, { _id: "b" }], status: "Exhausted", loadMore: () => undefined };
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[0] + 100)); });
    expect(subscriptions).toBe(2);
    expect(seen).toMatchObject({ results: [{ _id: "c" }, { _id: "a" }, { _id: "b" }], status: "Exhausted", failed: false });
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(globalThis, globals);
  }
});
