import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { describe, expect, test } from "bun:test";

import {
  activeInboxFilterCount,
  DEFAULT_INBOX_FILTERS,
  deriveInboxModel,
  desktopInboxTitle,
  resetInboxFilters,
  selectInboxFilter,
} from "./inbox-model";

const states: StateFilter[] = ["all", "unread", "unresponded", "waiting", "settled"];
const types: TypeFilter[] = ["all", "known", "dm", "group", "unknown"];

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

describe("selectInboxFilter", () => {
  test("preserves every state/type combination when changing either lens", () => {
    for (const state of states) {
      for (const type of types) {
        const filters = { state, type };

        expect(selectInboxFilter(filters, { kind: "state", value: state })).toEqual(filters);
        expect(selectInboxFilter(filters, { kind: "type", value: type })).toEqual(filters);
      }
    }
  });

  test("changes only the selected lens", () => {
    expect(selectInboxFilter({ state: "waiting", type: "group" }, { kind: "state", value: "unread" })).toEqual({
      state: "unread",
      type: "group",
    });
    expect(selectInboxFilter({ state: "waiting", type: "group" }, { kind: "type", value: "dm" })).toEqual({
      state: "waiting",
      type: "dm",
    });
  });
});

describe("inbox filter defaults", () => {
  test("defaults to the Known lens, not Everyone", () => {
    expect(DEFAULT_INBOX_FILTERS).toEqual({ state: "all", type: "known" });
  });

  test("returns a fresh copy of the default selection when reset", () => {
    const reset = resetInboxFilters();

    expect(reset).toEqual(DEFAULT_INBOX_FILTERS);
    expect(reset).not.toBe(DEFAULT_INBOX_FILTERS);
  });

  test("counts active state and type lenses independently", () => {
    expect(activeInboxFilterCount({ state: "all", type: "known" })).toBe(0);
    expect(activeInboxFilterCount({ state: "unread", type: "known" })).toBe(1);
    expect(activeInboxFilterCount({ state: "all", type: "group" })).toBe(1);
    expect(activeInboxFilterCount({ state: "waiting", type: "unknown" })).toBe(2);
    // Everyone is now a deliberate widening past the default, so it counts.
    expect(activeInboxFilterCount({ state: "all", type: "all" })).toBe(1);
  });
});

describe("desktopInboxTitle", () => {
  test("names the state alone while the type lens is at its default", () => {
    expect(desktopInboxTitle({ state: "all", type: "known" })).toBe("All messages");
    expect(desktopInboxTitle({ state: "unresponded", type: "known" })).toBe("Needs reply");
    expect(desktopInboxTitle({ state: "waiting", type: "known" })).toBe("Waiting");
    expect(desktopInboxTitle({ state: "unread", type: "known" })).toBe("Unread");
    expect(desktopInboxTitle({ state: "settled", type: "known" })).toBe("Settled");
  });

  test("appends the type lens whenever it is off its default", () => {
    // The defect this fixes. The header read "All messages" while the list
    // showed nothing but strangers.
    expect(desktopInboxTitle({ state: "all", type: "unknown" })).toBe("All messages · Unknown");
    expect(desktopInboxTitle({ state: "all", type: "all" })).toBe("All messages · Everyone");
    expect(desktopInboxTitle({ state: "unresponded", type: "group" })).toBe("Needs reply · Groups");
    expect(desktopInboxTitle({ state: "settled", type: "dm" })).toBe("Settled · DMs");
  });
});

describe("deriveInboxModel", () => {
  test("derives the default priority shelf, pinned-first recent list, and section metadata", () => {
    const oldestUnread = makeChat({ guid: "oldest", firstUnreadAt: 10 });
    const newerUnread = makeChat({ guid: "newer", firstUnreadAt: 20 });
    const pinnedRecent = makeChat({
      guid: "pinned",
      flags: { ...makeChat().flags, pinned: true },
    });
    const recent = makeChat({ guid: "recent" });

    const model = deriveInboxModel(
      [newerUnread, pinnedRecent, recent, oldestUnread],
      DEFAULT_INBOX_FILTERS,
      "  ",
    );

    expect(model.showPriorityShelf).toBe(true);
    expect(model.priority).toEqual([oldestUnread, newerUnread]);
    expect(model.listChats).toEqual([pinnedRecent, recent]);
    // Navigation order is rendered order: shelf first, then the list.
    expect(model.navigationEntries.map((e) => e.chat.guid)).toEqual([
      "oldest",
      "newer",
      "pinned",
      "recent",
    ]);
    expect(model.navigationEntries[0]?.location).toEqual({ kind: "priority", index: 0 });
    expect(model.navigationEntries[2]?.location).toEqual({ kind: "list", index: 0 });
    expect(model.sectionLabel).toBe("Recent");
    expect(model.sectionCount).toBe(2);
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
    // Everyone is not the default, so it loses the priority shelf and gets a
    // heading that names the lens.
    const everyone = deriveInboxModel([known, unknown, spam], { state: "all", type: "all" }, "");
    expect(everyone.showPriorityShelf).toBe(false);
    expect(everyone.sectionLabel).toBe("Everyone");
  });

  test("the default view keeps its priority shelf and Recent heading", () => {
    const unread = makeChat({ guid: "unread", firstUnreadAt: 10 });
    const stranger = makeChat({ guid: "stranger", known: false, firstUnreadAt: 5 });

    const model = deriveInboxModel([unread, stranger], DEFAULT_INBOX_FILTERS, "");

    expect(model.showPriorityShelf).toBe(true);
    expect(model.priority).toEqual([unread]);
    expect(model.sectionLabel).toBe("Recent");
    expect(activeInboxFilterCount(DEFAULT_INBOX_FILTERS)).toBe(0);
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
    expect(model.showPriorityShelf).toBe(false);
    expect(model.priority).toEqual([]);
    expect(model.listChats).toEqual([groupUnread, directUnread, groupWaiting]);
    expect(model.navigationEntries.map((e) => e.location.kind)).toEqual(["list", "list", "list"]);
    expect(model.sectionLabel).toBe("Search Results");
    expect(model.sectionCount).toBe(3);
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
    expect(model.showPriorityShelf).toBe(false);
    expect(model.sectionLabel).toBe("Settled");
    expect(model.sectionCount).toBe(1);
  });

  test("labels the settled lens beside a type lens", () => {
    const group = makeChat({ guid: "group", isGroup: true });

    const model = deriveInboxModel([group], { state: "settled", type: "group" }, "");

    expect(model.listChats).toEqual([group]);
    expect(model.sectionLabel).toBe("Settled · Groups");
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

  test("describes combined filters when there is no local search", () => {
    const groupUnread = makeChat({
      guid: "group-unread",
      isGroup: true,
      flags: { ...makeChat().flags, unread: true },
    });

    const model = deriveInboxModel([groupUnread], { state: "unread", type: "group" }, "");

    expect(model.sectionLabel).toBe("Unread · Groups");
    expect(model.sectionCount).toBe(1);
  });

  test("matches message text searches and labels the results", () => {
    const chat = makeChat({
      guid: "message-match",
      displayName: "No name match",
      lastMessage: { ...makeChat().lastMessage!, text: "Need a response about invoices" },
    });

    const model = deriveInboxModel([chat], DEFAULT_INBOX_FILTERS, "invoices");

    expect(model.listChats).toEqual([chat]);
    expect(model.showPriorityShelf).toBe(false);
    expect(model.listChats).toEqual([chat]);
    expect(model.sectionLabel).toBe("Search Results");
    expect(model.sectionCount).toBe(1);
  });
});
