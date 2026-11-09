import { describe, expect, test } from "bun:test";
import type { ChatState } from "./chat-state";
import {
  computeCounts,
  computeFlags,
  conversationFlags,
  isSettled,
  laterOf,
  matchesFilters,
  settleActionFor,
  settleLeavesLens,
} from "./chat-state";
import type { ChatFlags, ChatSummary, ConversationId } from "./types";

// ---------------------------------------------------------------- fixtures

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    mutedUnresponded: false,
    pinned: false,
    markedUnread: false,
    readAt: 0,
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

const IMESSAGE_DM = { platform: "imessage", kind: "dm" } as const;

function makeChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    conversationId: "chat-1" as ConversationId,
    route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;-;chat-1" } },
    displayName: "Chat 1",
    kind: "dm",
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

// ---------------------------------------------------------------- computeFlags

describe("computeFlags", () => {
  test("no state: inbound last is unresponded, not waiting", () => {
    const flags = computeFlags(IMESSAGE_DM, undefined, makeLast({ isFromMe: false }), 0);
    expect(flags).toEqual(
      makeFlags({ unresponded: true }),
    );
  });

  test("no state: outbound last is waiting, not unresponded", () => {
    const flags = computeFlags(IMESSAGE_DM, undefined, makeLast({ isFromMe: true }), 0);
    expect(flags).toEqual(makeFlags({ waiting: true }));
  });

  test("no last message: neither unresponded nor waiting", () => {
    const flags = computeFlags(IMESSAGE_DM, undefined, null, 0);
    expect(flags.unresponded).toBe(false);
    expect(flags.waiting).toBe(false);
  });

  test("dismissed unresponded guid matching last clears unresponded", () => {
    const flags = computeFlags(IMESSAGE_DM,
      makeState({ dismissedUnrespondedGuid: "m1" }),
      makeLast({ guid: "m1", isFromMe: false }),
      0,
    );
    expect(flags.unresponded).toBe(false);
  });

  test("dismissed unresponded guid for a different message leaves unresponded set", () => {
    const flags = computeFlags(IMESSAGE_DM,
      makeState({ dismissedUnrespondedGuid: "old" }),
      makeLast({ guid: "m1", isFromMe: false }),
      0,
    );
    expect(flags.unresponded).toBe(true);
  });

  test("dismissed waiting guid matching last clears waiting", () => {
    const flags = computeFlags(IMESSAGE_DM,
      makeState({ dismissedWaitingGuid: "m1" }),
      makeLast({ guid: "m1", isFromMe: true }),
      0,
    );
    expect(flags.waiting).toBe(false);
  });

  test("dismissed waiting guid for a different message leaves waiting set", () => {
    const flags = computeFlags(IMESSAGE_DM,
      makeState({ dismissedWaitingGuid: "old" }),
      makeLast({ guid: "m1", isFromMe: true }),
      0,
    );
    expect(flags.waiting).toBe(true);
  });

  test("legacy mutedUnresponded values no longer suppress inbound triage", () => {
    const flags = computeFlags(IMESSAGE_DM, makeState({ mutedUnresponded: true }), makeLast({ isFromMe: false }), 0);
    expect(flags.unresponded).toBe(true);
    expect(flags.mutedUnresponded).toBe(false);
  });

  test("markedUnread sets unread even with zero unread count", () => {
    const flags = computeFlags(IMESSAGE_DM, makeState({ markedUnread: true }), makeLast({ isFromMe: true }), 0);
    expect(flags.unread).toBe(true);
  });

  test("unread count drives unread without markedUnread", () => {
    const flags = computeFlags(IMESSAGE_DM, undefined, makeLast({ isFromMe: true }), 3);
    expect(flags.unread).toBe(true);
  });

  test("pinned state sets the pinned flag", () => {
    const flags = computeFlags(IMESSAGE_DM, makeState({ pinned: true }), makeLast(), 0);
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
      flags: computeFlags(IMESSAGE_DM, makeState(), makeLast({ guid: "m9" }), 0),
    });
    const settled = makeChat({
      lastMessage,
      flags: computeFlags(IMESSAGE_DM, makeState({ dismissedUnrespondedGuid: "m9" }), makeLast({ guid: "m9" }), 0),
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
      flags: computeFlags(IMESSAGE_DM, makeState(), makeLast({ guid: "m9", isFromMe: true }), 0),
    });
    const settled = makeChat({
      lastMessage,
      flags: computeFlags(IMESSAGE_DM,
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

  test("a quiet Slack channel wants nothing, so it is neither settled nor togglable", () => {
    const channel = makeChat({
      kind: "channel", route: { platform: "slack", accountId: "acct" as never, slack: { channel: "C1" } }, flags: makeFlags(),
    });
    expect(isSettled(channel)).toBe(false);
    expect(settleActionFor(channel)).toBe("none");
    const mentioned = { ...channel, lastMessage: { ...channel.lastMessage!, mentionsMe: true } };
    expect(isSettled(mentioned), "a settled mention is settled").toBe(true);
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
  test("settling clears the flags that define Needs you and Waiting", () => {
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

    expect(matchesFilters(unresolved, "all", "known")).toBe(true);
    expect(matchesFilters(unresolved, "all", "dm")).toBe(true);
    expect(matchesFilters(unresolved, "all", "unknown")).toBe(false);
    expect(matchesFilters(unresolvedSpam, "all", "known")).toBe(false);
    expect(matchesFilters(unresolvedSpam, "all", "unknown")).toBe(true);
    // Everyone is the one lens that does not care either way.
    expect(matchesFilters(unresolved, "all", "all")).toBe(true);
    expect(matchesFilters(unresolvedSpam, "all", "all")).toBe(true);
  });

  test("known is the inbox lens: everything except screened", () => {
    expect(matchesFilters(makeChat(), "all", "known")).toBe(true);
    expect(matchesFilters(makeChat({ isGroup: true }), "all", "known")).toBe(true);
    expect(matchesFilters(makeChat({ known: false }), "all", "known")).toBe(false);
    expect(matchesFilters(makeChat({ isSpam: true }), "all", "known")).toBe(false);
  });

  test("all is genuinely everything, screened included", () => {
    expect(matchesFilters(makeChat(), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ isGroup: true }), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ known: false }), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ isSpam: true }), "all", "all")).toBe(true);
    expect(matchesFilters(makeChat({ known: false, isSpam: true }), "all", "all")).toBe(true);
  });
});

describe("matchesFilters — screened conversation exclusion", () => {
  test("unknown and spam conversations are hidden from every known-only lens", () => {
    const unknown = makeChat({ known: false, flags: makeFlags({ unread: true }) });
    const spam = makeChat({ isSpam: true, flags: makeFlags({ unread: true }) });

    // DMs and Groups stay known-only by decision. A stranger's one-on-one
    // belongs to Unknown, not to DMs.
    for (const type of ["known", "dm", "group"] as const) {
      expect(matchesFilters(unknown, "all", type)).toBe(false);
      expect(matchesFilters(unknown, "unread", type)).toBe(false);
      expect(matchesFilters(unknown, "settled", type)).toBe(false);
      expect(matchesFilters(spam, "all", type)).toBe(false);
      expect(matchesFilters(spam, "unread", type)).toBe(false);
      expect(matchesFilters(spam, "settled", type)).toBe(false);
    }
  });

  test("everyone shows the same screened conversations, still state-filtered", () => {
    const unknown = makeChat({ known: false, flags: makeFlags({ unread: true }) });
    const spam = makeChat({ isSpam: true, flags: makeFlags({ unread: true }) });

    expect(matchesFilters(unknown, "all", "all")).toBe(true);
    expect(matchesFilters(unknown, "unread", "all")).toBe(true);
    expect(matchesFilters(spam, "all", "all")).toBe(true);
    expect(matchesFilters(spam, "unread", "all")).toBe(true);
    // Widening the type lens does not widen the state lens.
    expect(matchesFilters(unknown, "waiting", "all")).toBe(false);
    expect(matchesFilters(spam, "waiting", "all")).toBe(false);
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

describe("agent chats", () => {
  const agent = (attention: NonNullable<ChatSummary["agent"]>["attention"]): ChatSummary["agent"] =>
    ({ attention, chatId: "agent-1", title: "Guest list", openCount: 1, activityAt: 1 });
  // Flags clear and an outbound last message: settled but for the agent chat.
  const quiet = (attention: NonNullable<ChatSummary["agent"]>["attention"]) =>
    makeChat({ conversationId: `quiet-${attention}` as ConversationId, agent: agent(attention), lastMessage: { ...makeChat().lastMessage!, isFromMe: true } });

  test("an open agent chat puts a conversation with clear flags in Needs you and Agents, not Settled", () => {
    const row = quiet("working");
    expect(matchesFilters(row, "unresponded", "all")).toBe(true);
    expect(matchesFilters(row, "agents", "all")).toBe(true);
    expect(matchesFilters(row, "waiting", "all")).toBe(false);
    expect(isSettled(row)).toBe(false);
    expect(matchesFilters(row, "settled", "all")).toBe(false);
  });

  test("without an agent chat the conversation is settled and outside Agents", () => {
    const row = makeChat({ lastMessage: { ...makeChat().lastMessage!, isFromMe: true } });
    expect(matchesFilters(row, "agents", "all")).toBe(false);
    expect(matchesFilters(row, "unresponded", "all")).toBe(false);
    expect(isSettled(row)).toBe(true);
  });

  test("settle is offered when an agent chat is the only reason to be in Needs you, and it leaves Agents", () => {
    expect(settleActionFor(quiet("open"))).toBe("settle");
    expect(settleLeavesLens("settle", "agents")).toBe(true);
    expect(settleLeavesLens("unsettle", "agents")).toBe(false);
  });

  test("Needs you counts agent rows; Agents counts only the ones that want the user", () => {
    const rows = (["needs_you", "failed", "ready", "working", "open"] as const).map(quiet);
    const counts = computeCounts([...rows, makeChat({ conversationId: "inbound" as ConversationId, flags: makeFlags({ unresponded: true }) })], "all");
    expect(counts.unresponded).toBe(6);
    expect(counts.agents).toBe(3);
    expect(counts.settled).toBe(0);
  });
});

describe("computeCounts", () => {
  test("counts each state lens", () => {
    const chats = [
      makeChat({ conversationId: "a" as ConversationId, flags: makeFlags({ unread: true, unresponded: true }) }),
      makeChat({ conversationId: "b" as ConversationId, flags: makeFlags({ waiting: true }) }),
      makeChat({ conversationId: "c" as ConversationId, flags: makeFlags() }),
    ];
    const counts = computeCounts(chats, "all");
    expect(counts.all).toBe(3); // every chat, nothing is hidden from All
    expect(counts.unread).toBe(1);
    expect(counts.unresponded).toBe(1);
    expect(counts.waiting).toBe(1);
    expect(counts.settled).toBe(1); // only "c", which carries no triage flag
    expect(counts.drafts).toBe(0);
  });

  test("Drafts counts conversations with a draft and never drops a row on settle", () => {
    const drafted = makeChat({ conversationId: "d" as ConversationId, draft: { source: "agent", text: "hi", attachmentCount: 0, updatedAt: 1 } });
    expect(computeCounts([drafted, makeChat({ conversationId: "e"  as ConversationId})], "all").drafts).toBe(1);
    expect(matchesFilters(drafted, "drafts", "all")).toBe(true);
    expect(settleLeavesLens("settle", "drafts")).toBe(false);
  });

  test("counts a settled conversation with no last message as neither settled nor waiting", () => {
    const chats = [
      makeChat({ conversationId: "empty" as ConversationId, lastMessage: null, flags: makeFlags() }),
      makeChat({ conversationId: "settled" as ConversationId, flags: makeFlags() }),
    ];
    const counts = computeCounts(chats, "all");

    expect(counts.all).toBe(2);
    expect(counts.settled).toBe(1);
    expect(counts.unresponded).toBe(0);
    expect(counts.waiting).toBe(0);
  });

  test("each type lens counts exactly the conversations its lens shows", () => {
    const chats = [
      makeChat({ conversationId: "friend" as ConversationId, flags: makeFlags({ unread: true }) }),
      makeChat({ conversationId: "crew" as ConversationId, isGroup: true, flags: makeFlags({ unread: true }) }),
      makeChat({ conversationId: "stranger" as ConversationId, known: false, flags: makeFlags({ unread: true }) }),
      makeChat({ conversationId: "junk" as ConversationId, isSpam: true, flags: makeFlags({ unread: true }) }),
    ];

    // Everyone now counts the screened pair too; Known is the old All.
    expect(computeCounts(chats, "all").all).toBe(4);
    expect(computeCounts(chats, "all").unread).toBe(4);
    expect(computeCounts(chats, "known").all).toBe(2);
    expect(computeCounts(chats, "known").unread).toBe(2);
    expect(computeCounts(chats, "dm").all).toBe(1);
    expect(computeCounts(chats, "group").all).toBe(1);
    expect(computeCounts(chats, "unknown").all).toBe(2);
    // Known plus Unknown partition Everyone exactly.
    expect(computeCounts(chats, "known").all + computeCounts(chats, "unknown").all).toBe(
      computeCounts(chats, "all").all,
    );
  });
});

describe("Later and Follow up", () => {
  const until = 5000;

  test("a snoozed conversation carries no queue flag, and its unread count is zero", () => {
    const state = makeState({ snooze: { until, setAt: 1 }, markedUnread: true, pinned: true });
    expect(computeFlags(IMESSAGE_DM, state, makeLast(), 3)).toEqual(makeFlags({ pinned: true }));
    expect(conversationFlags(IMESSAGE_DM, state, makeLast(), 1000, 3).unreadCount).toBe(0);
  });

  test("one back from a snooze, or with a follow-up due, needs the user even when the user spoke last", () => {
    const last = makeLast({ isFromMe: true });
    expect(computeFlags(IMESSAGE_DM, makeState({ snoozeReturn: { reason: "time", until, at: until } }), last, 0)).toMatchObject({ unresponded: true, waiting: false });
    expect(computeFlags(IMESSAGE_DM, makeState({ followUp: { at: until, since: 1000, due: true }, dismissedWaitingGuid: "m1" }), last, 0))
      .toMatchObject({ unresponded: true, waiting: false });
    expect(computeFlags(IMESSAGE_DM, makeState({ followUp: { at: until, since: 1000, due: false } }), last, 0)).toMatchObject({ unresponded: false, waiting: true });
  });

  test("counts leave a snoozed conversation out of every queue but All, and Settled does not claim it", () => {
    const snoozed = makeChat({ conversationId: "s" as ConversationId, later: { snoozedUntil: until } });
    const open = makeChat({ conversationId: "o" as ConversationId, flags: makeFlags({ unresponded: true, unread: true }) });
    const counts = computeCounts([snoozed, open], "all");
    expect(counts).toMatchObject({ all: 2, unresponded: 1, unread: 1, waiting: 0, settled: 0 });
    expect(isSettled(snoozed)).toBe(false);
  });

  test("settling a snoozed conversation is Done", () => {
    expect(settleActionFor(makeChat({ later: { snoozedUntil: until } }))).toBe("settle");
  });

  test("laterOf leaves the scheduler's job ids out", () => {
    const state = { ...makeState({ snooze: { until, setAt: 1 }, followUp: { at: 9, since: 1, due: false } }), job: "x" };
    expect(laterOf(state)).toEqual({ snoozedUntil: until, followUp: { at: 9, since: 1, due: false } });
    expect(laterOf(makeState())).toBeUndefined();
  });
});
