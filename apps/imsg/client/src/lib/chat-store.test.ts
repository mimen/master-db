import { beforeEach, describe, expect, test } from "bun:test";

import {
  getChats,
  mutationEpochNow,
  patchChatFlags,
  resetChatStore,
  setChats,
  settlePendingFlags,
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
    resetChatStore();
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

describe("optimistic archive vs stale refetch", () => {
  beforeEach(() => {
    resetChatStore();
    setChats([chat("a")]);
  });

  test("a refetch that started before archive cannot resurrect the row", () => {
    const epochBefore = mutationEpochNow();
    patchChatFlags("a", { archived: true });
    expect(getChats()?.[0]?.flags.archived).toBe(true);

    const stale = refetched([chat("a")]);
    stale[0]!.flags.archived = false;
    setChats(stale, epochBefore);

    expect(getChats()?.[0]?.flags.archived).toBe(true);
  });

  test("a refetch that started after archive settled can confirm it", () => {
    patchChatFlags("a", { archived: true });
    settlePendingFlags("a");
    const epoch = mutationEpochNow();
    const confirmed = refetched([chat("a")]);
    confirmed[0]!.flags.archived = true;
    setChats(confirmed, epoch);
    expect(getChats()?.[0]?.flags.archived).toBe(true);

    const later = refetched([chat("a")]);
    later[0]!.flags.archived = false;
    setChats(later, epoch);
    expect(getChats()?.[0]?.flags.archived).toBe(false);
  });
});
