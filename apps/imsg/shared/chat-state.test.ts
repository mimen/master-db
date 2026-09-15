import { describe, expect, test } from "bun:test";
import type { ChatState } from "./chat-state";
import {
  applyMessage,
  computeCounts,
  computeFlags,
  isSettled,
  matchesFilters,
  partitionPriorityShelf,
  settleActionFor,
  settleLeavesLens,
} from "./chat-state";
import type { ChatFlags, ChatSummary, Message } from "./types";

// ---------------------------------------------------------------- fixtures

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatGuid: "chat-1",
    dismissedUnrespondedGuid: null,
    dismissedWaitingGuid: null,
    mutedUnresponded: 0,
    pinned: 0,
    markedUnread: 0,
    ...overrides,
  };
}

interface LastMessageLike {
  guid: string;
  dateCreated: number;
  isFromMe: boolean;
}

function makeLast(overrides: Partial<LastMessageLike> = {}): LastMessageLike {
  return { guid: "m1", dateCreated: 1000, isFromMe: false, ...overrides };
}

function makeFlags(overrides: Partial<ChatFlags> = {}): ChatFlags {
  return {
    unresponded: false,
    waiting: false,
    unread: false,
    mutedUnresponded: false,
    pinned: false,
    ...overrides,
  };
}

function makeChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid: "chat-1",
    displayName: "Chat 1",
    isGroup: false,
    known: true,
    isSpam: false,
    participants: [],
    lastMessage: {
      guid: "m1",
      text: "hi",
      dateCreated: 1000,
      isFromMe: false,
      senderName: "Alice",
      hasAttachments: false,
    },
    unreadCount: 0,
    firstUnreadAt: null,
    flags: makeFlags(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    guid: "m2",
    chatGuid: "chat-1",
    text: "hello",
    dateCreated: 2000,
    dateRead: null,
    dateDelivered: null,
    isFromMe: false,
    service: "iMessage",
    sender: null,
    attachments: [],
    special: null,
    sendEffect: null,
    reactions: [],
    replyToGuid: null,
    replyToPreview: null,
    replyToFromMe: null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------- computeFlags

describe("computeFlags", () => {
  test("no state: inbound last is unresponded, not waiting", () => {
    const flags = computeFlags(undefined, makeLast({ isFromMe: false }), 0);
    expect(flags).toEqual(
      makeFlags({ unresponded: true }),
    );
  });

  test("no state: outbound last is waiting, not unresponded", () => {
    const flags = computeFlags(undefined, makeLast({ isFromMe: true }), 0);
    expect(flags).toEqual(makeFlags({ waiting: true }));
  });

  test("no last message: neither unresponded nor waiting", () => {
    const flags = computeFlags(undefined, null, 0);
    expect(flags.unresponded).toBe(false);
    expect(flags.waiting).toBe(false);
  });

  test("dismissed unresponded guid matching last clears unresponded", () => {
    const flags = computeFlags(
      makeState({ dismissedUnrespondedGuid: "m1" }),
      makeLast({ guid: "m1", isFromMe: false }),
      0,
    );
    expect(flags.unresponded).toBe(false);
  });

  test("dismissed unresponded guid for a different message leaves unresponded set", () => {
    const flags = computeFlags(
      makeState({ dismissedUnrespondedGuid: "old" }),
      makeLast({ guid: "m1", isFromMe: false }),
      0,
    );
    expect(flags.unresponded).toBe(true);
  });

  test("dismissed waiting guid matching last clears waiting", () => {
    const flags = computeFlags(
      makeState({ dismissedWaitingGuid: "m1" }),
      makeLast({ guid: "m1", isFromMe: true }),
      0,
    );
    expect(flags.waiting).toBe(false);
  });

  test("dismissed waiting guid for a different message leaves waiting set", () => {
    const flags = computeFlags(
      makeState({ dismissedWaitingGuid: "old" }),
      makeLast({ guid: "m1", isFromMe: true }),
      0,
    );
    expect(flags.waiting).toBe(true);
  });

  test("legacy mutedUnresponded values no longer suppress inbound triage", () => {
    const flags = computeFlags(makeState({ mutedUnresponded: 1 }), makeLast({ isFromMe: false }), 0);
    expect(flags.unresponded).toBe(true);
    expect(flags.mutedUnresponded).toBe(false);
  });

  test("markedUnread sets unread even with zero unread count", () => {
    const flags = computeFlags(makeState({ markedUnread: 1 }), makeLast({ isFromMe: true }), 0);
    expect(flags.unread).toBe(true);
  });

  test("unread count drives unread without markedUnread", () => {
    const flags = computeFlags(undefined, makeLast({ isFromMe: true }), 3);
    expect(flags.unread).toBe(true);
  });

  test("pinned state sets the pinned flag", () => {
    const flags = computeFlags(makeState({ pinned: 1 }), makeLast(), 0);
    expect(flags.pinned).toBe(true);
  });

});

// ---------------------------------------------------------------- matchesFilters

describe("matchesFilters — state lenses", () => {
  test("all hides nothing that passes the type lens", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags({ unread: true }) }), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags({ waiting: true }) }), "all", "all")).toBe(true);
  });

  test("unread requires unread", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ unread: true }) }), "unread", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "unread", "all")).toBe(false);
  });

  test("unresponded requires unresponded", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ unresponded: true }) }), "unresponded", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "unresponded", "all")).toBe(false);
  });

  test("waiting requires waiting", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ waiting: true }) }), "waiting", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "waiting", "all")).toBe(false);
  });

  test("settled requires a last message with neither triage flag", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "settled", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags({ unresponded: true }) }), "settled", "all")).toBe(false);
    expect(matchesFilters(makeChat({ flags: makeFlags({ waiting: true }) }), "settled", "all")).toBe(false);
  });

  test("settled ignores unread and pinned, which are not triage state", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ unread: true }) }), "settled", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags({ pinned: true }) }), "settled", "all")).toBe(true);
  });

  test("a conversation with no last message never settles", () => {
    const empty = makeChat({ lastMessage: null, flags: makeFlags() });

    expect(matchesFilters(empty, "settled", "all")).toBe(false);
    expect(matchesFilters(empty, "all", "all")).toBe(true);
  });

  test("dismissing the inbound anchor moves a conversation from unresponded to settled", () => {
    const lastMessage = {
      guid: "m9",
      text: "hi",
      dateCreated: 1000,
      isFromMe: false,
      senderName: "Alice",
      hasAttachments: false,
    };
    const open = makeChat({
      lastMessage,
      flags: computeFlags(makeState(), makeLast({ guid: "m9" }), 0),
    });
    const settled = makeChat({
      lastMessage,
      flags: computeFlags(makeState({ dismissedUnrespondedGuid: "m9" }), makeLast({ guid: "m9" }), 0),
    });

    expect(matchesFilters(open, "unresponded", "all")).toBe(true);
    expect(matchesFilters(open, "settled", "all")).toBe(false);
    expect(matchesFilters(settled, "unresponded", "all")).toBe(false);
    expect(matchesFilters(settled, "settled", "all")).toBe(true);
  });

  test("dismissing the outbound anchor moves a conversation from waiting to settled", () => {
    const lastMessage = {
      guid: "m9",
      text: "sent",
      dateCreated: 1000,
      isFromMe: true,
      senderName: null,
      hasAttachments: false,
    };
    const open = makeChat({
      lastMessage,
      flags: computeFlags(makeState(), makeLast({ guid: "m9", isFromMe: true }), 0),
    });
    const settled = makeChat({
      lastMessage,
      flags: computeFlags(
        makeState({ dismissedWaitingGuid: "m9" }),
        makeLast({ guid: "m9", isFromMe: true }),
        0,
      ),
    });

    expect(matchesFilters(open, "waiting", "all")).toBe(true);
    expect(matchesFilters(open, "settled", "all")).toBe(false);
    expect(matchesFilters(settled, "waiting", "all")).toBe(false);
    expect(matchesFilters(settled, "settled", "all")).toBe(true);
  });
});

// ------------------------------------------------- the one triage gesture

describe("settleActionFor", () => {
  test("a conversation carrying either triage flag settles", () => {
    expect(settleActionFor(makeChat({ flags: makeFlags({ unresponded: true }) }))).toBe("settle");
    expect(settleActionFor(makeChat({ flags: makeFlags({ waiting: true }) }))).toBe("settle");
    expect(settleActionFor(makeChat({ flags: makeFlags({ unresponded: true, waiting: true }) }))).toBe("settle");
  });

  test("a settled conversation un-settles — the same control, keyed to its state", () => {
    expect(settleActionFor(makeChat({ flags: makeFlags() }))).toBe("unsettle");
  });

  test("unread and pinned are not triage state, so they don't change the action", () => {
    expect(settleActionFor(makeChat({ flags: makeFlags({ unread: true, pinned: true }) }))).toBe("unsettle");
    expect(settleActionFor(makeChat({ flags: makeFlags({ unread: true, waiting: true }) }))).toBe("settle");
  });

  test("a conversation with no messages has nothing to toggle either way", () => {
    expect(settleActionFor(makeChat({ lastMessage: null, flags: makeFlags() }))).toBe("none");
  });

  test("the gesture and the Settled lens read the same predicate", () => {
    const chats = [
      makeChat({ flags: makeFlags({ unresponded: true }) }),
      makeChat({ flags: makeFlags({ waiting: true }) }),
      makeChat({ flags: makeFlags() }),
      makeChat({ lastMessage: null, flags: makeFlags() }),
    ];

    for (const chat of chats) {
      const inSettledLens = matchesFilters(chat, "settled", "all");
      expect(isSettled(chat)).toBe(inSettledLens);
      expect(settleActionFor(chat) === "unsettle").toBe(inSettledLens);
    }
  });
});

describe("settleLeavesLens — whether the row drops out from under the cursor", () => {
  test("settling clears the flags that define Needs reply and Waiting", () => {
    expect(settleLeavesLens("settle", "unresponded")).toBe(true);
    expect(settleLeavesLens("settle", "waiting")).toBe(true);
  });

  test("settling from All, Unread or Settled leaves the row exactly where it was", () => {
    expect(settleLeavesLens("settle", "all")).toBe(false);
    expect(settleLeavesLens("settle", "unread")).toBe(false);
    expect(settleLeavesLens("settle", "settled")).toBe(false);
  });

  test("un-settling only ever removes the row from the Settled lens", () => {
    expect(settleLeavesLens("unsettle", "settled")).toBe(true);
    for (const lens of ["all", "unread", "unresponded", "waiting"] as const) {
      expect(settleLeavesLens("unsettle", lens)).toBe(false);
    }
  });

  test("a gesture that does nothing never moves the cursor", () => {
    for (const lens of ["all", "unread", "unresponded", "waiting", "settled"] as const) {
      expect(settleLeavesLens("none", lens)).toBe(false);
    }
  });
});

describe("matchesFilters — type lenses", () => {
  test("dm excludes groups and screened conversations", () => {
    expect(matchesFilters(makeChat({ isGroup: false }), "all", "dm")).toBe(true);
    expect(matchesFilters(makeChat({ isGroup: true }), "all", "dm")).toBe(false);
    expect(matchesFilters(makeChat({ known: false }), "all", "dm")).toBe(false);
    expect(matchesFilters(makeChat({ isSpam: true }), "all", "dm")).toBe(false);
  });

  test("group requires a known, non-spam group", () => {
    expect(matchesFilters(makeChat({ isGroup: true }), "all", "group")).toBe(true);
    expect(matchesFilters(makeChat({ isGroup: false }), "all", "group")).toBe(false);
    expect(matchesFilters(makeChat({ isGroup: true, known: false }), "all", "group")).toBe(false);
    expect(matchesFilters(makeChat({ isGroup: true, isSpam: true }), "all", "group")).toBe(false);
  });

  test("unknown reveals unknown and spam conversations", () => {
    expect(matchesFilters(makeChat({ known: false }), "all", "unknown")).toBe(true);
    expect(matchesFilters(makeChat({ isSpam: true }), "all", "unknown")).toBe(true);
    expect(matchesFilters(makeChat(), "all", "unknown")).toBe(false);
  });

  test("contact classification failures fail open", () => {
    const unresolved = makeChat({ known: false, contactsAvailable: false });
    const unresolvedSpam = makeChat({ known: false, contactsAvailable: false, isSpam: true });

    expect(matchesFilters(unresolved, "all", "all")).toBe(true);
    expect(matchesFilters(unresolved, "all", "dm")).toBe(true);
    expect(matchesFilters(unresolved, "all", "unknown")).toBe(false);
    expect(matchesFilters(unresolvedSpam, "all", "all")).toBe(false);
    expect(matchesFilters(unresolvedSpam, "all", "unknown")).toBe(true);
  });
});

describe("matchesFilters — screened conversation exclusion", () => {
  test("unknown and spam conversations are hidden from every standard lens", () => {
    const unknown = makeChat({ known: false, flags: makeFlags({ unread: true }) });
    const spam = makeChat({ isSpam: true, flags: makeFlags({ unread: true }) });

    for (const type of ["all", "dm", "group"] as const) {
      expect(matchesFilters(unknown, "all", type)).toBe(false);
      expect(matchesFilters(unknown, "unread", type)).toBe(false);
      expect(matchesFilters(unknown, "settled", type)).toBe(false);
      expect(matchesFilters(spam, "all", type)).toBe(false);
      expect(matchesFilters(spam, "unread", type)).toBe(false);
      expect(matchesFilters(spam, "settled", type)).toBe(false);
    }
  });

  test("unknown lens preserves state filtering for screened conversations", () => {
    const unknownUnread = makeChat({ known: false, flags: makeFlags({ unread: true }) });
    const spamWaiting = makeChat({ isSpam: true, flags: makeFlags({ waiting: true }) });

    expect(matchesFilters(unknownUnread, "unread", "unknown")).toBe(true);
    expect(matchesFilters(unknownUnread, "waiting", "unknown")).toBe(false);
    expect(matchesFilters(spamWaiting, "unread", "unknown")).toBe(false);
    expect(matchesFilters(spamWaiting, "waiting", "unknown")).toBe(true);
  });
});

// ---------------------------------------------------------------- computeCounts

describe("computeCounts", () => {
  test("counts each state lens", () => {
    const chats = [
      makeChat({ guid: "a", flags: makeFlags({ unread: true, unresponded: true }) }),
      makeChat({ guid: "b", flags: makeFlags({ waiting: true }) }),
      makeChat({ guid: "c", flags: makeFlags() }),
    ];
    const counts = computeCounts(chats, "all");
    expect(counts.all).toBe(3); // every chat, nothing is hidden from All
    expect(counts.unread).toBe(1);
    expect(counts.unresponded).toBe(1);
    expect(counts.waiting).toBe(1);
    expect(counts.settled).toBe(1); // only "c", which carries no triage flag
  });

  test("counts a settled conversation with no last message as neither settled nor waiting", () => {
    const chats = [
      makeChat({ guid: "empty", lastMessage: null, flags: makeFlags() }),
      makeChat({ guid: "settled", flags: makeFlags() }),
    ];
    const counts = computeCounts(chats, "all");

    expect(counts.all).toBe(2);
    expect(counts.settled).toBe(1);
    expect(counts.unresponded).toBe(0);
    expect(counts.waiting).toBe(0);
  });
});

// ------------------------------------------------------- partitionPriorityShelf

describe("partitionPriorityShelf", () => {
  test("selects the oldest unread chats (up to 10) and leaves the rest recent", () => {
    const chats = [
      makeChat({ guid: "a", firstUnreadAt: 500 }),
      makeChat({ guid: "b", firstUnreadAt: null }),
      makeChat({ guid: "c", firstUnreadAt: 100 }),
      makeChat({ guid: "d", firstUnreadAt: 400 }),
      makeChat({ guid: "e", firstUnreadAt: 200 }),
      makeChat({ guid: "f", firstUnreadAt: 300 }),
      makeChat({ guid: "g", firstUnreadAt: null }),
      makeChat({ guid: "h", firstUnreadAt: undefined }),
    ];

    const partition = partitionPriorityShelf(chats);

    expect(partition.priority.map((chat) => chat.guid)).toEqual(["c", "e", "f", "d", "a"]);
    expect(partition.recent.map((chat) => chat.guid)).toEqual(["b", "g", "h"]);
  });

  test("caps the priority shelf at ten oldest unread", () => {
    const chats = Array.from({ length: 14 }, (_, i) =>
      makeChat({ guid: `u${i}`, firstUnreadAt: (i + 1) * 100 }),
    );
    expect(partitionPriorityShelf(chats).priority).toHaveLength(10);
  });

  test("preserves input order for equal timestamps", () => {
    const chats = [
      makeChat({ guid: "a", firstUnreadAt: 100 }),
      makeChat({ guid: "b", firstUnreadAt: 100 }),
      makeChat({ guid: "c", firstUnreadAt: 50 }),
    ];

    expect(partitionPriorityShelf(chats).priority.map((chat) => chat.guid)).toEqual(["c", "a", "b"]);
  });

  test("ignores pinned state", () => {
    const chats = [
      makeChat({ guid: "pinned", firstUnreadAt: 300, flags: makeFlags({ pinned: true }) }),
      makeChat({ guid: "normal", firstUnreadAt: 100 }),
    ];

    expect(partitionPriorityShelf(chats).priority.map((chat) => chat.guid)).toEqual(["normal", "pinned"]);
  });

  test("returns every chat in exactly one partition", () => {
    const chats = [
      makeChat({ guid: "a", firstUnreadAt: 100 }),
      makeChat({ guid: "b", firstUnreadAt: null }),
      makeChat({ guid: "c", firstUnreadAt: 200 }),
    ];

    const { priority, recent } = partitionPriorityShelf(chats);
    expect([...priority, ...recent]).toHaveLength(chats.length);
    expect(new Set([...priority, ...recent])).toEqual(new Set(chats));
  });

  // ---------------------------------------------------- CRM priority feed-in

  test("CRM P1/P2 chats lead the shelf, best priority first, even with no unread", () => {
    const chats = [
      makeChat({ guid: "unread-only", firstUnreadAt: 100 }),
      makeChat({ guid: "p2-no-unread", firstUnreadAt: null, crm: { priority: 2 } }),
      makeChat({ guid: "p1-no-unread", firstUnreadAt: null, crm: { priority: 1 } }),
    ];

    const { priority, recent } = partitionPriorityShelf(chats);
    expect(priority.map((c) => c.guid)).toEqual(["p1-no-unread", "p2-no-unread", "unread-only"]);
    expect(recent).toHaveLength(0);
  });

  test("within a priority tier, oldest-unread breaks ties; no-unread sorts after any unread", () => {
    const chats = [
      makeChat({ guid: "p1-no-unread", firstUnreadAt: null, crm: { priority: 1 } }),
      makeChat({ guid: "p1-older", firstUnreadAt: 100, crm: { priority: 1 } }),
      makeChat({ guid: "p1-newer", firstUnreadAt: 200, crm: { priority: 1 } }),
    ];

    const { priority } = partitionPriorityShelf(chats);
    expect(priority.map((c) => c.guid)).toEqual(["p1-older", "p1-newer", "p1-no-unread"]);
  });

  test("a priority chat that's also oldest-unread is placed once, not duplicated", () => {
    const chats = [
      makeChat({ guid: "p1-and-unread", firstUnreadAt: 50, crm: { priority: 1 } }),
      makeChat({ guid: "unread-a", firstUnreadAt: 100 }),
      makeChat({ guid: "unread-b", firstUnreadAt: 150 }),
    ];

    const { priority, recent } = partitionPriorityShelf(chats);
    expect(priority.map((c) => c.guid)).toEqual(["p1-and-unread", "unread-a", "unread-b"]);
    expect(recent).toHaveLength(0);
  });

  test("priority tier plus oldest-unread fill fills remaining slots up to the 10 cap", () => {
    const priorityChats = Array.from({ length: 3 }, (_, i) =>
      makeChat({ guid: `p1-${i}`, firstUnreadAt: null, crm: { priority: 1 } }),
    );
    const unreadChats = Array.from({ length: 9 }, (_, i) =>
      makeChat({ guid: `u-${i}`, firstUnreadAt: (i + 1) * 100 }),
    );
    const { priority, recent } = partitionPriorityShelf([...priorityChats, ...unreadChats]);

    expect(priority).toHaveLength(10);
    expect(priority.slice(0, 3).map((c) => c.guid)).toEqual(["p1-0", "p1-1", "p1-2"]);
    // Only the 7 oldest of the 9 unread chats fit in the remaining slots.
    expect(priority.slice(3).map((c) => c.guid)).toEqual(["u-0", "u-1", "u-2", "u-3", "u-4", "u-5", "u-6"]);
    expect(recent.map((c) => c.guid)).toEqual(["u-7", "u-8"]);
  });

  test("no unread and no priority stays out of the shelf entirely", () => {
    const chats = [
      makeChat({ guid: "quiet", firstUnreadAt: null }),
      makeChat({ guid: "quiet-p3", firstUnreadAt: null, crm: { priority: 3 } }),
      makeChat({ guid: "unread", firstUnreadAt: 100 }),
    ];

    const { priority, recent } = partitionPriorityShelf(chats);
    expect(priority.map((c) => c.guid)).toEqual(["unread"]);
    expect(recent.map((c) => c.guid).sort()).toEqual(["quiet", "quiet-p3"]);
  });

  test("no chat has CRM priority: behaves exactly like the old oldest-unread-only selection", () => {
    const chats = [
      makeChat({ guid: "a", firstUnreadAt: 500 }),
      makeChat({ guid: "b", firstUnreadAt: null }),
      makeChat({ guid: "c", firstUnreadAt: 100 }),
    ];

    expect(partitionPriorityShelf(chats).priority.map((c) => c.guid)).toEqual(["c", "a"]);
    expect(partitionPriorityShelf(chats).recent.map((c) => c.guid)).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------- applyMessage

describe("applyMessage", () => {
  test("inbound message sets unresponded/unread and moves to top", () => {
    const chats = [
      makeChat({ guid: "other", lastMessage: { ...makeChat().lastMessage!, dateCreated: 5000 } }),
      makeChat({ guid: "chat-1", flags: makeFlags() }),
    ];
    const result = applyMessage(chats, "chat-1", makeMessage({ isFromMe: false, dateCreated: 6000 }));
    expect(result).not.toBeNull();
    const next = result!;
    expect(next[0]!.guid).toBe("chat-1");
    expect(next[0]!.flags.unresponded).toBe(true);
    expect(next[0]!.flags.waiting).toBe(false);
    expect(next[0]!.flags.unread).toBe(true);
    expect(next[0]!.firstUnreadAt).toBe(6000);
    expect(next[0]!.unreadCount).toBe(1);
  });

  test("realtime junk classification updates screening immediately", () => {
    const chats = [makeChat({ guid: "chat-1" })];
    const next = applyMessage(chats, "chat-1", makeMessage({ dateCreated: 6000, isSpam: true }))!;

    expect(next[0]!.isSpam).toBe(true);
    expect(matchesFilters(next[0]!, "all", "all")).toBe(false);
    expect(matchesFilters(next[0]!, "all", "unknown")).toBe(true);
  });

  test("inbound message ignores legacy mutedUnresponded flags", () => {
    const chats = [makeChat({ guid: "chat-1", flags: makeFlags({ mutedUnresponded: true }) })];
    const next = applyMessage(chats, "chat-1", makeMessage({ isFromMe: false, dateCreated: 6000 }))!;
    expect(next[0]!.flags.unresponded).toBe(true);
  });

  test("qualifying inbound messages preserve the earliest unread timestamp", () => {
    const chats = [makeChat({ guid: "chat-1", firstUnreadAt: 4000 })];
    const next = applyMessage(chats, "chat-1", makeMessage({ dateCreated: 6000 }))!;
    expect(next[0]!.firstUnreadAt).toBe(4000);
  });

  test("non-qualifying messages do not create an unread timestamp", () => {
    const messages = [
      makeMessage({ isFromMe: true }),
      makeMessage({ dateRead: 3000 }),
      makeMessage({ retracted: true }),
      makeMessage({ isGroupEvent: true }),
      makeMessage({ isAssociatedMessage: true }),
    ];

    for (const message of messages) {
      const next = applyMessage([makeChat({ guid: "chat-1" })], "chat-1", message)!;
      expect(next[0]!.firstUnreadAt).toBeNull();
      expect(next[0]!.unreadCount).toBe(0);
    }
  });

  test("outbound message sets waiting, clears unresponded, preserves unread", () => {
    const chats = [
      makeChat({
        guid: "chat-1",
        firstUnreadAt: 4000,
        flags: makeFlags({ unresponded: true, unread: true }),
      }),
    ];
    const next = applyMessage(chats, "chat-1", makeMessage({ isFromMe: true, dateCreated: 6000 }))!;
    expect(next[0]!.flags.waiting).toBe(true);
    expect(next[0]!.flags.unresponded).toBe(false);
    expect(next[0]!.flags.unread).toBe(true);
    expect(next[0]!.firstUnreadAt).toBe(4000);
  });

  test("stale message returns the same array reference", () => {
    const chats = [makeChat({ guid: "chat-1", lastMessage: { ...makeChat().lastMessage!, dateCreated: 9000 } })];
    const result = applyMessage(chats, "chat-1", makeMessage({ dateCreated: 1 }));
    expect(result).toBe(chats);
  });

  test("unknown chat guid returns null", () => {
    const chats = [makeChat({ guid: "chat-1" })];
    expect(applyMessage(chats, "missing", makeMessage())).toBeNull();
  });

  test("empty text with attachments falls back to Attachment", () => {
    const chats = [makeChat({ guid: "chat-1" })];
    const next = applyMessage(
      chats,
      "chat-1",
      makeMessage({
        text: "",
        dateCreated: 6000,
        attachments: [{ guid: "a", mimeType: null, filename: null, width: null, height: null, totalBytes: null }],
      }),
    )!;
    expect(next[0]!.lastMessage!.text).toBe("Attachment");
    expect(next[0]!.lastMessage!.hasAttachments).toBe(true);
  });

  test("senderName prefers name over address over null", () => {
    const chats = [makeChat({ guid: "chat-1" }), makeChat({ guid: "chat-2" }), makeChat({ guid: "chat-3" })];
    const withName = applyMessage(chats, "chat-1", makeMessage({ dateCreated: 6000, sender: { address: "+1", name: "Bob" } }))!;
    expect(withName[0]!.lastMessage!.senderName).toBe("Bob");
    const withAddress = applyMessage(chats, "chat-2", makeMessage({ dateCreated: 6000, sender: { address: "+1", name: null } }))!;
    expect(withAddress[0]!.lastMessage!.senderName).toBe("+1");
    const withNeither = applyMessage(chats, "chat-3", makeMessage({ dateCreated: 6000, sender: null }))!;
    expect(withNeither[0]!.lastMessage!.senderName).toBeNull();
  });
});
