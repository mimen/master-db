import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { presenceApi, usePeerTypingValue, type PeerPresence } from "./presence-api";
import { usePrivateApi } from "../hooks/use-health";

test("health falls back to false for missing state and follows capability updates", () => {
  expect(usePrivateApi(() => undefined)).toBe(false);
  expect(usePrivateApi(() => null)).toBe(false);
  const state = { key: "mini" as const, privateApi: true, suggestions: true, reactionSuggestions: true, whisperAvailable: false, lastSeenAt: 1000 };
  expect(usePrivateApi(() => state)).toBe(true);
  expect(usePrivateApi(() => ({ ...state, privateApi: false }))).toBe(false);
  expect(getFunctionName(presenceApi.bridgeState)).toBe("comma/bridgeState:bridgeState");
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
