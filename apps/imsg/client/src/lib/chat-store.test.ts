import { beforeEach, describe, expect, test } from "bun:test";

// AsyncStorage resolves to its web build here, which reaches for
// window.localStorage. Shim it so these exercise the real storage path rather
// than a mock that could drift from it.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  getChats,
  hydrateChats,
  resetStoreForTest,
  setChats,
  subscribeChats,
} from "./chat-store";
import type { ChatSummary } from "@shared/types";

function chat(guid: string, unreadCount = 0): ChatSummary {
  return {
    guid,
    displayName: `Chat ${guid}`,
    isGroup: false,
    known: true,
    isSpam: false,
    participants: [{ address: `+1555000${guid}`, name: null }],
    lastMessage: {
      guid: `m-${guid}`,
      text: "hello",
      dateCreated: 1000,
      isFromMe: false,
      senderName: null,
      hasAttachments: false,
    },
    unreadCount,
    firstUnreadAt: null,
    flags: {
      unread: unreadCount > 0,
      archived: false,
      pinned: false,
      unresponded: false,
      waiting: false,
      mutedUnresponded: false,
    },
  } as ChatSummary;
}

/** A refetch always yields fresh objects — the server response is re-parsed. */
function refetched(chats: ChatSummary[]): ChatSummary[] {
  return JSON.parse(JSON.stringify(chats)) as ChatSummary[];
}

describe("setChats identity reconciliation", () => {
  beforeEach(() => {
    setChats([]);
  });

  test("keeps the previous object when a refetch changes nothing", () => {
    const first = [chat("a"), chat("b")];
    setChats(first);
    const before = getChats();

    setChats(refetched(first));
    const after = getChats();

    // This is the whole point: without it every row memo and every FlashList
    // cell invalidates ~every 1.2s while messages are flowing.
    expect(after?.[0]).toBe(before?.[0]);
    expect(after?.[1]).toBe(before?.[1]);
  });

  test("skips the emit entirely when nothing differs", () => {
    setChats([chat("a")]);
    let emits = 0;
    const unsubscribe = subscribeChats(() => {
      emits++;
    });
    setChats(refetched([chat("a")]));
    unsubscribe();
    expect(emits).toBe(0);
  });

  test("replaces only the conversation that actually changed", () => {
    const first = [chat("a"), chat("b")];
    setChats(first);
    const before = getChats();

    setChats(refetched([chat("a"), chat("b", 3)]));
    const after = getChats();

    expect(after?.[0]).toBe(before?.[0]);
    expect(after?.[1]).not.toBe(before?.[1]);
    expect(after?.[1]?.unreadCount).toBe(3);
  });

  test("a reorder is a real change even when every chat is identical", () => {
    const first = [chat("a"), chat("b")];
    setChats(first);
    let emits = 0;
    const unsubscribe = subscribeChats(() => {
      emits++;
    });
    setChats(refetched([chat("b"), chat("a")]));
    unsubscribe();

    expect(emits).toBe(1);
    expect(getChats()?.map((c) => c.guid)).toEqual(["b", "a"]);
  });

  test("removals and additions still land", () => {
    setChats([chat("a"), chat("b")]);
    setChats(refetched([chat("a")]));
    expect(getChats()?.map((c) => c.guid)).toEqual(["a"]);

    setChats(refetched([chat("a"), chat("c")]));
    expect(getChats()?.map((c) => c.guid)).toEqual(["a", "c"]);
  });
});

describe("cold-start hydration", () => {
  test("seeds the list from disk so a launch paints real content", async () => {
    const cached = [chat("a"), chat("b")];
    await AsyncStorage.setItem("imsg.chats.v1", JSON.stringify(cached));
    resetStoreForTest();

    await hydrateChats();

    // The whole point: no skeleton, no round trip to the Mini before first paint.
    expect(getChats()?.map((c) => c.guid)).toEqual(["a", "b"]);
  });

  test("a slow disk read never clobbers data the server already returned", async () => {
    await AsyncStorage.setItem("imsg.chats.v1", JSON.stringify([chat("stale")]));
    resetStoreForTest();

    setChats([chat("fresh")]); // fetch lands first
    await hydrateChats();

    expect(getChats()?.map((c) => c.guid)).toEqual(["fresh"]);
  });

  test("a corrupt cache is ignored rather than crashing the launch", async () => {
    await AsyncStorage.setItem("imsg.chats.v1", "{not json");
    resetStoreForTest();

    await hydrateChats();

    expect(getChats()).toBeNull();
  });
});
