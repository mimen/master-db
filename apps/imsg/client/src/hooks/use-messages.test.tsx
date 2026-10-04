import { expect, test } from "bun:test";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import type { messageWindow, MessageWindowArgs } from "../lib/history-api";

import { useMessageWindow } from "./use-message-window";

type Rows = FunctionReturnType<typeof messageWindow>;
function row(date: number, guid = `m-${date}`): Rows[number] {
  return {
    _id: guid as Rows[number]["_id"], _creationTime: date, guid,
    conversationId: "one" as Rows[number]["conversationId"], chatGuid: "one", dateCreated: date,
    isFromMe: false, text: guid, service: "iMessage", error: 0, edited: false,
    retracted: false, isTapback: false, reactions: [], isGroupEvent: false,
    mentions: [], attachmentGuids: [], sourceVersion: 1, attachments: [],
  };
}

test("anchored history subscribes, pages once per direction, preserves local sends, and ignores stale requests", async () => {
  const dom = new JSDOM("<div id='history-root'></div>");
  const globals = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const listeners = new Set<() => void>();
  const snapshots = new Map<string, Rows>();
  const queries: Array<{ name: string; args: MessageWindowArgs; resolve: (rows: Rows) => void }> = [];
  const subscriptions: Array<{ name: string; args: MessageWindowArgs }> = [];
  const client = {
    watchQuery: (ref: FunctionReference<"query">, args: MessageWindowArgs) => {
      subscriptions.push({ name: getFunctionName(ref), args });
      return {
        onUpdate: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
        localQueryResult: () => snapshots.get(JSON.stringify(args)), journal: () => undefined,
      };
    },
    query: (ref: FunctionReference<"query">, args: MessageWindowArgs) => new Promise<Rows>((resolve) => {
      queries.push({ name: getFunctionName(ref), args, resolve });
    }),
  } as unknown as ConvexReactClient;
  let result: ReturnType<typeof useMessageWindow> | undefined;
  function Thread({ conversationId = "one", around = 50 }: { conversationId?: string; around?: number }) {
    result = useMessageWindow(conversationId, conversationId, { guid: `anchor-${around}`, dateCreated: around });
    return createElement("div", null, result.messages.map((m) => m.guid).join(","));
  }
  const root = createRoot(globalThis.document.getElementById("history-root")!);
  const render = async (conversationId = "one", around = 50) => {
    await act(async () => { root.render(createElement(ConvexProvider, { client }, createElement(Thread, { conversationId, around }))); });
  };
  const publish = async (rows: Rows, conversationId = "one", around = 50) => {
    snapshots.set(JSON.stringify({ conversationId, around }), rows);
    await act(async () => { for (const callback of listeners) callback(); });
  };
  try {
    await render();
    expect(result?.loading).toBe(true);
    await publish(Array.from({ length: 80 }, (_, i) => row(i + 11)));
    expect(result?.messages).toHaveLength(80);
    expect(result?.hasMore).toBe(true);
    expect(result?.hasNewer).toBe(true);
    expect(subscriptions.every((q) => q.name === "comma/history:messageWindow")).toBe(true);
    await act(async () => { result?.loadOlder(); result?.loadOlder(); result?.loadNewer(); result?.loadNewer(); });
    expect(queries.map((q) => ({ ...q.args, conversationId: String(q.args.conversationId) }))).toEqual([{ conversationId: "one", before: 11 }, { conversationId: "one", after: 90 }]);
    await act(async () => { queries[0].resolve([row(1)]); queries[1].resolve([row(100)]); });
    expect(result?.messages[0].guid).toBe("m-1");
    expect(result?.messages.at(-1)?.guid).toBe("m-100");
    expect(result?.hasMore).toBe(false);
    expect(result?.hasNewer).toBe(false);
    const own = { ...result!.messages[0], guid: "temp-own", clientKey: "temp-own", pending: true, isFromMe: true, dateCreated: 200 };
    await act(async () => { result?.upsert(own); });
    await publish(Array.from({ length: 79 }, (_, i) => ({ ...row(i + 12), ...(i === 0 ? { text: "edited", reactions: [{ type: "love" as const, isFromMe: true, senderAddress: null, senderName: null }] } : {}) })));
    expect(result?.messages.some((m) => m.guid === "m-11")).toBe(false);
    expect(result?.messages.find((m) => m.guid === "m-12")).toMatchObject({ text: "edited", reactions: [{ type: "love" }] });
    expect(result?.messages.some((m) => m.guid === "m-1")).toBe(true);
    expect(result?.messages.some((m) => m.guid === "temp-own")).toBe(true);
    await act(async () => { result?.loadOlder(); });
    const stale = queries.at(-1)!;
    await render("two", 0);
    expect(result?.messages).toEqual([]);
    await act(async () => { stale.resolve([row(-10)]); });
    expect(result?.messages).toEqual([]);
    await publish([row(0, "two-anchor")], "two", 0);
    expect(result?.messages.map((m) => m.guid)).toEqual(["two-anchor"]);
    await publish([], "two", 0);
    expect(result?.messages).toEqual([]);
  } finally {
    await act(async () => { root.unmount(); });
    expect(listeners.size).toBe(0);
    Object.assign(globalThis, globals);
    dom.window.close();
  }
});
