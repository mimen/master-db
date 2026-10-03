import { expect, mock, test } from "bun:test";
import type { Message } from "@shared/types";

const calls: string[] = [];
let respond: (batch: Message[]) => void = () => {};

mock.module("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
mock.module("@/lib/api", () => ({
  registerMessageActions: () => () => {},
  api: {
    messages: (guid: string) => {
      calls.push(guid);
      return new Promise<Message[]>((resolve) => {
        respond = resolve;
      });
    },
  },
}));

const { applyThreadEvent, cachedThread, fetchNewest, prefetchThread } = await import("./use-messages");

function message(guid: string, chatGuid: string, dateCreated: number, text = guid): Message {
  return {
    guid, chatGuid, text, dateCreated,
    dateRead: null, dateDelivered: null, isFromMe: false, service: "iMessage",
    sender: null, attachments: [], special: null, sendEffect: null, reactions: [],
    replyToGuid: null, replyToPreview: null, replyToFromMe: null,
    isGroupEvent: false, error: 0, edited: false, retracted: false,
  };
}

test("a press-down prefetch and the open that follows share one request", async () => {
  prefetchThread("chat-a");
  const opened = fetchNewest("chat-a");
  expect(calls).toEqual(["chat-a"]);

  respond([]);
  expect(await opened).toEqual([]);

  void fetchNewest("chat-a");
  expect(calls).toEqual(["chat-a", "chat-a"]);
});

test("a live message for a chat never opened is cached, and its history merges in behind it", async () => {
  const live = message("live", "chat-b", 300);
  applyThreadEvent({ kind: "new-message", chatGuid: "chat-b", message: live });
  expect(cachedThread("chat-b")).toEqual([live]);

  prefetchThread("chat-b");
  respond([message("old", "chat-b", 100), message("older", "chat-b", 50)]);
  await fetchNewest("chat-b").catch(() => undefined);
  await Promise.resolve();
  expect(cachedThread("chat-b")?.map((m) => m.guid)).toEqual(["older", "old", "live"]);
});

test("live messages, edits, and tapbacks land in a cached thread that is not open", () => {
  const first = message("m1", "chat-c", 100);
  applyThreadEvent({ kind: "new-message", chatGuid: "chat-c", message: first });
  applyThreadEvent({ kind: "new-message", chatGuid: "chat-c", message: first });
  applyThreadEvent({ kind: "updated-message", chatGuid: "chat-c", message: { ...first, text: "edited", edited: true } });
  const love = { type: "love", isFromMe: false, senderName: null, senderAddress: "+1555" };
  applyThreadEvent({ kind: "reaction", chatGuid: "chat-c", targetGuid: "m1", reaction: love, remove: false });
  applyThreadEvent({ kind: "reaction", chatGuid: "chat-c", targetGuid: "m1", reaction: love, remove: false });
  applyThreadEvent({ kind: "reaction", chatGuid: "chat-c", targetGuid: "missing", reaction: love, remove: false });
  expect(cachedThread("chat-c")).toEqual([{ ...first, text: "edited", edited: true, reactions: [love] }]);

  applyThreadEvent({ kind: "reaction", chatGuid: "chat-c", targetGuid: "m1", reaction: love, remove: true });
  applyThreadEvent({ kind: "typing", chatGuid: "chat-c", display: true });
  expect(cachedThread("chat-c")?.[0]?.reactions).toEqual([]);
  applyThreadEvent({ kind: "updated-message", chatGuid: "chat-unseen", message: message("u1", "chat-unseen", 100) });
  expect(cachedThread("chat-unseen")).toBeUndefined();
});
