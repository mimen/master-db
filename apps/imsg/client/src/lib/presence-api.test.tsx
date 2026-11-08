import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { presenceApi, usePeerTypingValue, type ExecutorStatus, type PeerPresence } from "./presence-api";
import { routeStatus } from "@shared/executors";
import { bridgeSupport } from "../hooks/use-health";

test("a route reads its own executor's capabilities, and nothing before that executor reports", () => {
  const imessage = (accountId: string, privateApi: boolean): ExecutorStatus => ({ key: `imessage:${accountId}`, connected: true, lastSeenAt: 1000,
    capabilities: { executor: "imessage", privateApi, emojiReactions: privateApi } });
  const ai: ExecutorStatus = { key: "ai", connected: true, lastSeenAt: 1000, capabilities: { executor: "ai", suggestions: true, whisperAvailable: false } };
  const rows = [ai, imessage("a1", true)];
  expect(bridgeSupport(routeStatus(rows, { platform: "imessage", accountId: "a1" }))).toEqual({ privateApi: true, emojiReactions: true });
  // A conversation the accounts backfill has not reached reads its platform's only account.
  expect(bridgeSupport(routeStatus(rows, { platform: "imessage", accountId: null }))).toEqual({ privateApi: true, emojiReactions: true });
  expect(routeStatus([...rows, imessage("a2", false)], { platform: "imessage", accountId: null })).toBeNull();
  expect(bridgeSupport(routeStatus(rows, { platform: "imessage", accountId: "other" }))).toEqual({ privateApi: false, emojiReactions: false });
  expect(bridgeSupport(undefined)).toEqual({ privateApi: false, emojiReactions: false });
  expect(bridgeSupport(ai)).toEqual({ privateApi: false, emojiReactions: false });
  expect(getFunctionName(presenceApi.routeStatus)).toBe("comma/bridgeState:routeExecutorStatus");
  expect(getFunctionName(presenceApi.presence)).toBe("comma/presence:presence");
});

test("peer typing clears with its own timer, follows on/off, and cancels old chat timers", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const actDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  function Indicator({ row }: { row: PeerPresence | null }) {
    return createElement("span", null, String(usePeerTypingValue(row)));
  }
  const render = async (row: PeerPresence | null) => {
    await act(async () => { root.render(createElement(Indicator, { row })); });
  };
  try {
    await render(null); expect(container.textContent).toBe("false");
    await render({ peerTyping: true, updatedAt: Date.now(), expiresAt: Date.now() + 100 });
    expect(container.textContent).toBe("true");
    await act(async () => { await Bun.sleep(125); });
    expect(container.textContent).toBe("false");
    const row = { peerTyping: true, updatedAt: Date.now(), expiresAt: Date.now() + 1000 };
    await render(row); expect(container.textContent).toBe("true");
    await render({ ...row, peerTyping: false }); expect(container.textContent).toBe("false");
    await render({ ...row, peerTyping: true, expiresAt: Date.now() - 1 }); expect(container.textContent).toBe("false");
    await render(row); expect(container.textContent).toBe("true");
    await render(null); expect(container.textContent).toBe("false");
  } finally {
    await act(async () => { root.unmount(); });
    for (const [name, descriptor] of [["window", windowDescriptor], ["document", documentDescriptor], ["IS_REACT_ACT_ENVIRONMENT", actDescriptor]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});
