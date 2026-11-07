import { beforeEach, expect, mock, test } from "bun:test";
import type { ConversationId } from "@shared/types";

const pushed: unknown[] = [];
mock.module("expo-router", () => ({ router: { push: (route: unknown) => pushed.push(route) } }));

const { onOpenAgentPane, openAgentPane, takeRequestedAgentChat } = await import("./agent-pane");

const cid = (id: string) => id as ConversationId;

beforeEach(() => {
  pushed.length = 0;
});

test("on the phone the requested chat rides the route as its chat param", () => {
  openAgentPane(cid("c-1"), "chat-2");
  openAgentPane(cid("c-1"));
  expect(pushed).toEqual([
    { pathname: "/agent", params: { conversation: "c-1", chat: "chat-2" } },
    { pathname: "/agent", params: { conversation: "c-1" } },
  ]);
  expect(takeRequestedAgentChat(cid("c-1"))).toBeUndefined();
});

test("in the wide shell the pane reads the requested chat once, per conversation", () => {
  const opened: (string | undefined)[] = [];
  const stop = onOpenAgentPane(() => opened.push(takeRequestedAgentChat(cid("a"))));
  openAgentPane(cid("a"), "chat-1");
  openAgentPane(cid("b"), "chat-9");
  openAgentPane(cid("a"));
  stop();
  expect(opened).toEqual(["chat-1", undefined, undefined]);
  expect(takeRequestedAgentChat(cid("b"))).toBe("chat-9");
  expect(takeRequestedAgentChat(cid("b"))).toBeUndefined();
  expect(pushed).toEqual([]);
});
