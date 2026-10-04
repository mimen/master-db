import { describe, expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { readChatSnapshot, writeChatSnapshot, SNAPSHOT_MAX } from "./chat-snapshot";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const chat = (i: number): ChatSummary => ({
  guid: `iMessage;-;+1555000${String(i).padStart(4, "0")}`, displayName: `Person ${i}`, isGroup: false, known: true,
  isSpam: false, participants: [{ address: `+1555000${i}`, name: `Person ${i}` }], unreadCount: 0,
  lastMessage: { guid: `m${i}`, text: "hi", dateCreated: 1000 - i, isFromMe: false, senderName: null, hasAttachments: false },
  flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
});

describe("chat snapshot", () => {
  test("round-trips the newest chats so a cold start can paint before Convex answers", () => {
    const store = memory();
    writeChatSnapshot(store, [chat(1), chat(2)]);
    expect(readChatSnapshot(store)?.map((c) => c.displayName)).toEqual(["Person 1", "Person 2"]);
  });

  test("keeps at most SNAPSHOT_MAX chats", () => {
    const store = memory();
    writeChatSnapshot(store, Array.from({ length: SNAPSHOT_MAX + 50 }, (_, i) => chat(i)));
    expect(readChatSnapshot(store)).toHaveLength(SNAPSHOT_MAX);
  });

  test("an empty, corrupt or foreign value reads as no snapshot", () => {
    const store = memory();
    expect(readChatSnapshot(store)).toBeNull();
    store.setItem("imsg.chatSnapshot.v1", "{not json");
    expect(readChatSnapshot(store)).toBeNull();
    store.setItem("imsg.chatSnapshot.v1", JSON.stringify({ version: 0, chats: [] }));
    expect(readChatSnapshot(store)).toBeNull();
    expect(readChatSnapshot(undefined)).toBeNull();
  });
});
