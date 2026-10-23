import { beforeEach, expect, mock, test } from "bun:test";

const pushed: unknown[] = [];
mock.module("expo-router", () => ({ router: { push: (route: unknown) => pushed.push(route) } }));

const { onOpenAgentPane, openAgentPane, takeRequestedAgentChat } = await import("./agent-pane");

beforeEach(() => {
  pushed.length = 0;
});

test("on the phone the requested chat rides the route as its chat param", () => {
  openAgentPane("iMessage;-;+1", "chat-2");
  openAgentPane("iMessage;-;+1");
  expect(pushed).toEqual([
    { pathname: "/agent", params: { guid: "iMessage;-;+1", chat: "chat-2" } },
    { pathname: "/agent", params: { guid: "iMessage;-;+1" } },
  ]);
  expect(takeRequestedAgentChat("iMessage;-;+1")).toBeUndefined();
});

test("in the wide shell the pane reads the requested chat once, per conversation", () => {
  const opened: (string | undefined)[] = [];
  const stop = onOpenAgentPane(() => opened.push(takeRequestedAgentChat("a")));
  openAgentPane("a", "chat-1");
  openAgentPane("b", "chat-9");
  openAgentPane("a");
  stop();
  expect(opened).toEqual(["chat-1", undefined, undefined]);
  expect(takeRequestedAgentChat("b")).toBe("chat-9");
  expect(takeRequestedAgentChat("b")).toBeUndefined();
  expect(pushed).toEqual([]);
});
