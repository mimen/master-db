import { describe, expect, test } from "bun:test";
import type { ChatState } from "./chat-state";
import {
  applyMessage,
  computeCounts,
  computeFlags,
  isArchived,
  matchesFilters,
  partitionPriorityShelf,
} from "./chat-state";
import type { ChatFlags, ChatSummary, Message } from "./types";

// ---------------------------------------------------------------- fixtures

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatGuid: "chat-1",
    archivedAt: null,
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
    archived: false,
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

// ---------------------------------------------------------------- isArchived

describe("isArchived", () => {
  test("no state is not archived", () => {
    expect(isArchived(undefined, makeLast())).toBe(false);
  });

  test("null archivedAt is not archived", () => {
    expect(isArchived(makeState({ archivedAt: null }), makeLast())).toBe(false);
  });

  test("archived with no last message stays archived", () => {
    expect(isArchived(makeState({ archivedAt: 500 }), null)).toBe(true);
  });

  test("inbound newer than archivedAt auto-unarchives", () => {
    expect(isArchived(makeState({ archivedAt: 500 }), makeLast({ dateCreated: 600, isFromMe: false }))).toBe(false);
  });

  test("outbound newer than archivedAt does not unarchive", () => {
    expect(isArchived(makeState({ archivedAt: 500 }), makeLast({ dateCreated: 600, isFromMe: true }))).toBe(true);
  });

  test("inbound older than archivedAt stays archived", () => {
    expect(isArchived(makeState({ archivedAt: 500 }), makeLast({ dateCreated: 400, isFromMe: false }))).toBe(true);
  });
});

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

  test("mutedUnresponded suppresses unresponded and sets the flag", () => {
    const flags = computeFlags(makeState({ mutedUnresponded: 1 }), makeLast({ isFromMe: false }), 0);
    expect(flags.unresponded).toBe(false);
    expect(flags.mutedUnresponded).toBe(true);
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

  test("inbound newer than archivedAt reports not archived", () => {
    const flags = computeFlags(
      makeState({ archivedAt: 500 }),
      makeLast({ dateCreated: 600, isFromMe: false }),
      0,
    );
    expect(flags.archived).toBe(false);
  });

  test("outbound newer than archivedAt stays archived", () => {
    const flags = computeFlags(
      makeState({ archivedAt: 500 }),
      makeLast({ dateCreated: 600, isFromMe: true }),
      0,
    );
    expect(flags.archived).toBe(true);
  });

  test("inbound older than archivedAt stays archived", () => {
    const flags = computeFlags(
      makeState({ archivedAt: 500 }),
      makeLast({ dateCreated: 400, isFromMe: false }),
      0,
    );
    expect(flags.archived).toBe(true);
  });
});

// ---------------------------------------------------------------- matchesFilters

describe("matchesFilters — state lenses", () => {
  test("all excludes archived, includes the rest", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags({ archived: true }) }), "all", "all")).toBe(false);
  });

  test("unread requires unread and not archived", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ unread: true }) }), "unread", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "unread", "all")).toBe(false);
    expect(
      matchesFilters(makeChat({ flags: makeFlags({ unread: true, archived: true }) }), "unread", "all"),
    ).toBe(false);
  });

  test("unresponded requires unresponded and not archived", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ unresponded: true }) }), "unresponded", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "unresponded", "all")).toBe(false);
  });

  test("waiting requires waiting and not archived", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ waiting: true }) }), "waiting", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "waiting", "all")).toBe(false);
  });

  test("archived requires archived", () => {
    expect(matchesFilters(makeChat({ flags: makeFlags({ archived: true }) }), "archived", "all")).toBe(true);
    expect(matchesFilters(makeChat({ flags: makeFlags() }), "archived", "all")).toBe(false);
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
    const archivedUnknown = makeChat({ known: false, flags: makeFlags({ archived: true }) });
    const archivedSpam = makeChat({ isSpam: true, flags: makeFlags({ archived: true }) });

    for (const type of ["all", "dm", "group"] as const) {
      expect(matchesFilters(unknown, "all", type)).toBe(false);
      expect(matchesFilters(unknown, "unread", type)).toBe(false);
      expect(matchesFilters(archivedUnknown, "archived", type)).toBe(false);
      expect(matchesFilters(spam, "all", type)).toBe(false);
      expect(matchesFilters(spam, "unread", type)).toBe(false);
      expect(matchesFilters(archivedSpam, "archived", type)).toBe(false);
    }
  });

  test("unknown lens preserves state filtering for screened conversations", () => {
    const unknownUnread = makeChat({ known: false, flags: makeFlags({ unread: true }) });
    const archivedSpam = makeChat({ isSpam: true, flags: makeFlags({ archived: true }) });

    expect(matchesFilters(unknownUnread, "unread", "unknown")).toBe(true);
    expect(matchesFilters(unknownUnread, "archived", "unknown")).toBe(false);
    expect(matchesFilters(archivedSpam, "all", "unknown")).toBe(false);
    expect(matchesFilters(archivedSpam, "archived", "unknown")).toBe(true);
  });
});

// ---------------------------------------------------------------- computeCounts

describe("computeCounts", () => {
  test("counts each state lens", () => {
    const chats = [
      makeChat({ guid: "a", flags: makeFlags({ unread: true, unresponded: true }) }),
      makeChat({ guid: "b", flags: makeFlags({ waiting: true }) }),
      makeChat({ guid: "c", flags: makeFlags({ archived: true }) }),
    ];
    const counts = computeCounts(chats, "all");
    expect(counts.all).toBe(2); // a and b, not the archived c
    expect(counts.unread).toBe(1);
    expect(counts.unresponded).toBe(1);
    expect(counts.waiting).toBe(1);
    expect(counts.archived).toBe(1);
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
});

// ---------------------------------------------------------------- applyMessage

describe("applyMessage", () => {
  test("inbound message sets unresponded/unread, clears archived, moves to top", () => {
    const chats = [
      makeChat({ guid: "other", lastMessage: { ...makeChat().lastMessage!, dateCreated: 5000 } }),
      makeChat({ guid: "chat-1", flags: makeFlags({ archived: true }) }),
    ];
    const result = applyMessage(chats, "chat-1", makeMessage({ isFromMe: false, dateCreated: 6000 }));
    expect(result).not.toBeNull();
    const next = result!;
    expect(next[0]!.guid).toBe("chat-1");
    expect(next[0]!.flags.unresponded).toBe(true);
    expect(next[0]!.flags.waiting).toBe(false);
    expect(next[0]!.flags.unread).toBe(true);
    expect(next[0]!.flags.archived).toBe(false);
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

  test("inbound message on a muted chat does not set unresponded", () => {
    const chats = [makeChat({ guid: "chat-1", flags: makeFlags({ mutedUnresponded: true }) })];
    const next = applyMessage(chats, "chat-1", makeMessage({ isFromMe: false, dateCreated: 6000 }))!;
    expect(next[0]!.flags.unresponded).toBe(false);
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

  test("outbound message sets waiting, clears unresponded, preserves unread and archived", () => {
    const chats = [
      makeChat({
        guid: "chat-1",
        firstUnreadAt: 4000,
        flags: makeFlags({ unresponded: true, unread: true, archived: true }),
      }),
    ];
    const next = applyMessage(chats, "chat-1", makeMessage({ isFromMe: true, dateCreated: 6000 }))!;
    expect(next[0]!.flags.waiting).toBe(true);
    expect(next[0]!.flags.unresponded).toBe(false);
    expect(next[0]!.flags.unread).toBe(true);
    expect(next[0]!.flags.archived).toBe(true);
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
