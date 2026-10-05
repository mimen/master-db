import type { ChatSummary } from "@shared/types";
import { describe, expect, test } from "bun:test";

import {
  desktopInboxTitle,
  activeChips,
  checkboxCounts,
  DEFAULT_INBOX_FILTERS,
  DEFAULT_REFINEMENTS,
  deriveInboxModel,
  groupByAge,
  priorityLevel,
  resetInboxFilters,
  tagsInUse,
  viewName,
  type RefineContext,
  type Refinements,
} from "./inbox-model";

const NOW = new Date(2026, 9, 4, 15, 0).getTime();
const HOUR = 3_600_000;

function makeChat(overrides: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid: "chat-1",
    displayName: "Chat 1",
    isGroup: false,
    known: true,
    isSpam: false,
    participants: [],
    lastMessage: {
      guid: "message-1",
      text: "Hello",
      dateCreated: 1,
      isFromMe: false,
      senderName: null,
      hasAttachments: false,
    },
    unreadCount: 0,
    firstUnreadAt: null,
    flags: {
      unresponded: false,
      waiting: false,
      unread: false,
      mutedUnresponded: false,
      pinned: false,
    },
    ...overrides,
  };
}

describe("inbox filter defaults", () => {
  test("defaults to the Known lens, not Everyone", () => {
    expect(DEFAULT_INBOX_FILTERS).toEqual({ state: "all", type: "known" });
  });

  test("returns a fresh copy of the default selection when reset", () => {
    const reset = resetInboxFilters();
    expect(reset).toEqual(DEFAULT_INBOX_FILTERS);
    expect(reset).not.toBe(DEFAULT_INBOX_FILTERS);
  });
});

describe("desktopInboxTitle", () => {
  test("names the lens alone while People is at its default, and adds People otherwise", () => {
    expect(desktopInboxTitle({ state: "all", type: "known" })).toBe("All messages");
    expect(desktopInboxTitle({ state: "unresponded", type: "known" })).toBe("Needs reply");
    expect(desktopInboxTitle({ state: "all", type: "unknown" })).toBe("All messages · Unknown numbers");
    expect(desktopInboxTitle({ state: "settled", type: "dm" })).toBe("Settled · One-to-one");
  });
});

describe("deriveInboxModel", () => {
  test("the default All view lists every conversation, pinned first", () => {
    const chats = Array.from({ length: 14 }, (_, i) =>
      makeChat({ guid: `unread-${i}`, firstUnreadAt: i, flags: { ...makeChat().flags, unread: true } }),
    );
    const pinned = makeChat({ guid: "pinned", flags: { ...makeChat().flags, pinned: true } });

    const model = deriveInboxModel([...chats, pinned], DEFAULT_INBOX_FILTERS, "  ");

    expect(model.listChats.map((c) => c.guid)).toEqual([
      "pinned",
      ...chats.map((c) => c.guid),
    ]);
    // Index 0 is the age section row, so keyboard indices point past it.
    expect(model.navigationEntries.map((e) => e.index)).toEqual(model.listChats.map((_, i) => i + 1));
      });

  test("hides unknown and spam by default, reveals them under Unknown and Everyone", () => {
    const known = makeChat({ guid: "known" });
    const unknown = makeChat({ guid: "unknown", known: false });
    const spam = makeChat({ guid: "spam", isSpam: true });

    expect(deriveInboxModel([known, unknown, spam], DEFAULT_INBOX_FILTERS, "").listChats).toEqual([
      known,
    ]);
    expect(
      deriveInboxModel([known, unknown, spam], { state: "all", type: "unknown" }, "").listChats,
    ).toEqual([unknown, spam]);
    expect(
      deriveInboxModel([known, unknown, spam], { state: "all", type: "all" }, "").listChats,
    ).toEqual([known, unknown, spam]);
  });

  test("search supersedes the state/type lenses (matches across everything)", () => {
    const groupUnread = makeChat({
      guid: "group-unread",
      displayName: "Project group",
      isGroup: true,
      flags: { ...makeChat().flags, unread: true },
    });
    const directUnread = makeChat({
      guid: "direct-unread",
      displayName: "Project direct",
      flags: { ...makeChat().flags, unread: true },
    });
    const groupWaiting = makeChat({
      guid: "group-waiting",
      displayName: "Project waiting",
      isGroup: true,
      flags: { ...makeChat().flags, waiting: true },
    });

    const model = deriveInboxModel(
      [groupUnread, directUnread, groupWaiting],
      { state: "unread", type: "group" },
      "project",
    );

    // Search is a mode: the unread/group lenses do NOT constrain results.
    expect(model.listChats).toEqual([groupUnread, directUnread, groupWaiting]);
  });

  test("the settled lens lists only conversations with neither triage flag", () => {
    const settled = makeChat({ guid: "settled" });
    const needsReply = makeChat({
      guid: "needs-reply",
      flags: { ...makeChat().flags, unresponded: true },
    });
    const waiting = makeChat({ guid: "waiting", flags: { ...makeChat().flags, waiting: true } });
    const empty = makeChat({ guid: "empty", lastMessage: null });

    const model = deriveInboxModel(
      [settled, needsReply, waiting, empty],
      { state: "settled", type: "known" },
      "",
    );

    expect(model.listChats).toEqual([settled]);
  });

  test("labels the settled lens beside a type lens", () => {
    const group = makeChat({ guid: "group", isGroup: true });

    const model = deriveInboxModel([group], { state: "settled", type: "group" }, "");

    expect(model.listChats).toEqual([group]);
  });

  test("keeps pinned conversations first in filtered views", () => {
    const regular = makeChat({
      guid: "regular",
      flags: { ...makeChat().flags, unread: true },
    });
    const pinned = makeChat({
      guid: "pinned",
      flags: { ...makeChat().flags, unread: true, pinned: true },
    });

    const model = deriveInboxModel([regular, pinned], { state: "unread", type: "known" }, "");

    expect(model.listChats).toEqual([pinned, regular]);
  });

  test("matches message text searches and labels the results", () => {
    const chat = makeChat({
      guid: "message-match",
      displayName: "No name match",
      lastMessage: { ...makeChat().lastMessage!, text: "Need a response about invoices" },
    });

    const model = deriveInboxModel([chat], DEFAULT_INBOX_FILTERS, "invoices");

    expect(model.listChats).toEqual([chat]);
  });
});

const at = (hoursAgo: number) => NOW - hoursAgo * HOUR;
function chatAt(guid: string, hoursAgo: number, overrides: Partial<ChatSummary> = {}): ChatSummary {
  return makeChat({ guid, lastMessage: { ...makeChat().lastMessage!, dateCreated: at(hoursAgo) }, ...overrides });
}
const ctx = (refinements: Partial<Refinements>, scheduled: string[] = []): RefineContext => ({
  refinements: { ...DEFAULT_REFINEMENTS, ...refinements },
  scheduled: new Set(scheduled),
  now: NOW,
});
const needsReply = { ...DEFAULT_INBOX_FILTERS, state: "unresponded" as const };
const replyFlags = { ...makeChat().flags, unresponded: true };

describe("groupByAge", () => {
  test("sections Today, This week and Older with counts, skipping empty ones", () => {
    const rows = groupByAge([chatAt("a", 1), chatAt("b", 30), chatAt("c", 50), chatAt("d", 24 * 20)], NOW);
    expect(rows.map((r) => (r.kind === "section" ? `${r.label}:${r.count}` : r.chat.guid))).toEqual([
      "Today:1", "a", "This week:2", "b", "c", "Older:1", "d",
    ]);
  });

  test("orders each group pinned, then CRM priority, then newest, without crossing groups", () => {
    const pinned = chatAt("pinned", 40, { flags: { ...makeChat().flags, pinned: true } });
    const priority = chatAt("priority", 35, { crm: { priority: 2 } as ChatSummary["crm"] });
    const rows = groupByAge([chatAt("today", 1), chatAt("newer", 30), priority, pinned], NOW);
    expect(rows.map((r) => (r.kind === "section" ? r.label : r.chat.guid))).toEqual([
      "Today", "today", "This week", "pinned", "priority", "newer",
    ]);
  });
});

describe("refinements", () => {
  const sms = chatAt("SMS;-;+1555", 1, { flags: replyFlags });
  const imsg = chatAt("iMessage;-;a@b.c", 1, { flags: replyFlags, crm: { priority: 1, tags: ["showcase"], is_favorite: true } });
  const old = chatAt("iMessage;-;old", 24 * 10, { flags: replyFlags, crm: { priority: 4, tags: ["press"] } });
  const settled = chatAt("iMessage;-;settled", 2, { conversationId: "conv-s" });
  const chats = [sms, imsg, old, settled];
  const guids = (r: Partial<Refinements>, scheduled?: string[]) =>
    deriveInboxModel(chats, needsReply, "", undefined, undefined, ctx(r, scheduled)).listChats.map((c) => c.guid);

  test("service, time, priority and tags narrow the lens", () => {
    expect(guids({ service: "SMS" })).toEqual([sms.guid]);
    expect(guids({ service: "iMessage" })).toEqual([imsg.guid, old.guid]);
    // Within an age group the lens order holds: CRM P1 ahead of a newer conversation.
    expect(guids({ time: "week" })).toEqual([imsg.guid, sms.guid]);
    expect(guids({ priority: "high" })).toEqual([imsg.guid]);
    expect(guids({ priority: "low" })).toEqual([old.guid]);
    expect(guids({ tags: ["press", "showcase"] })).toEqual([imsg.guid, old.guid]);
  });

  test("only-show boxes all have to hold", () => {
    expect(guids({ only: ["favorites"] })).toEqual([imsg.guid]);
    expect(guids({ only: ["favorites", "pinned"] })).toEqual([]);
  });

  test("also-include widens the lens with settled or scheduled conversations", () => {
    expect(guids({})).not.toContain(settled.guid);
    expect(guids({ include: ["settled"] })).toContain(settled.guid);
    expect(guids({ include: ["scheduled"] }, ["conv-s"])).toContain(settled.guid);
    expect(guids({ include: ["scheduled"] }, [])).not.toContain(settled.guid);
  });

  test("search ignores refinements", () => {
    const model = deriveInboxModel(chats, needsReply, "hello", undefined, undefined, ctx({ service: "SMS" }));
    expect(model.listChats).toHaveLength(4);
  });

  test("checkbox counts say what each box would leave", () => {
    const counts = checkboxCounts(chats, needsReply, undefined, ctx({}));
    expect(counts.favorites).toBe(1);
    expect(counts.settled).toBe(4);
    expect(counts.attachments).toBe(0);
  });

  test("tags in use are deduped and sorted", () => {
    expect(tagsInUse(chats)).toEqual(["press", "showcase"]);
  });

  test("priority levels map P1-P2 high, P3 medium, P4-P5 low", () => {
    expect([1, 2, 3, 4, 5, undefined].map(priorityLevel)).toEqual(["high", "high", "medium", "low", "low", null]);
  });
});

describe("activeChips", () => {
  const r: Refinements = { ...DEFAULT_REFINEMENTS, service: "SMS", time: "week", tags: ["showcase"] };
  const filters = { state: "unresponded" as const, type: "known" as const };

  test("one chip per active value, the People lens off its default included", () => {
    expect(activeChips(filters, r).map((c) => [c.prefix, c.label])).toEqual([
      [undefined, "SMS"], [undefined, "Last 7 days"], ["Tag", "showcase"],
    ]);
    expect(activeChips({ ...filters, type: "unknown" }, DEFAULT_REFINEMENTS).map((c) => c.label)).toEqual(["Unknown numbers"]);
  });

  test("removing a chip clears only its own value", () => {
    const tag = activeChips(filters, r).find((c) => c.key === "tag-showcase")!;
    expect(tag.remove(filters, r).refinements).toEqual({ ...r, tags: [] });
    const people = activeChips({ ...filters, type: "group" }, r)[0]!;
    expect(people.remove({ ...filters, type: "group" }, r).filters.type).toBe("known");
  });

  test("a saved view is named after its chips", () => {
    expect(viewName(filters, r)).toBe("SMS, Last 7 days, Tag showcase");
  });
});
