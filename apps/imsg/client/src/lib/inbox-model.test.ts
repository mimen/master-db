import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";
import { describe, expect, test } from "bun:test";

import {
  activeInboxFilterCount,
  DEFAULT_INBOX_FILTERS,
  deriveInboxModel,
  resetInboxFilters,
  selectInboxFilter,
} from "./inbox-model";

const states: StateFilter[] = ["all", "unread", "unresponded", "waiting", "archived"];
const types: TypeFilter[] = ["all", "dm", "group", "unknown"];

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
      archived: false,
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
  test("returns a fresh all/all selection when reset", () => {
    const reset = resetInboxFilters();

    expect(reset).toEqual(DEFAULT_INBOX_FILTERS);
    expect(reset).not.toBe(DEFAULT_INBOX_FILTERS);
  });

  test("counts active state and type lenses independently", () => {
    expect(activeInboxFilterCount({ state: "all", type: "all" })).toBe(0);
    expect(activeInboxFilterCount({ state: "unread", type: "all" })).toBe(1);
    expect(activeInboxFilterCount({ state: "all", type: "group" })).toBe(1);
    expect(activeInboxFilterCount({ state: "archived", type: "unknown" })).toBe(2);
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

    expect(model.searchedChats).toEqual([newerUnread, pinnedRecent, recent, oldestUnread]);
    expect(model.showPriorityShelf).toBe(true);
    expect(model.priority).toEqual([oldestUnread, newerUnread]);
    expect(model.recent).toEqual([pinnedRecent, recent]);
    expect(model.listChats).toEqual([pinnedRecent, recent]);
    expect(model.sectionLabel).toBe("Recent");
    expect(model.sectionCount).toBe(2);
  });

  test("applies state/type filters and search before disabling priority presentation", () => {
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

    expect(model.searchedChats).toEqual([groupUnread]);
    expect(model.showPriorityShelf).toBe(false);
    expect(model.priority).toEqual([]);
    expect(model.recent).toEqual([groupUnread]);
    expect(model.listChats).toEqual([groupUnread]);
    expect(model.sectionLabel).toBe("Search Results");
    expect(model.sectionCount).toBe(1);
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

    const model = deriveInboxModel([regular, pinned], { state: "unread", type: "all" }, "");

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

    expect(model.searchedChats).toEqual([chat]);
    expect(model.showPriorityShelf).toBe(false);
    expect(model.listChats).toEqual([chat]);
    expect(model.sectionLabel).toBe("Search Results");
    expect(model.sectionCount).toBe(1);
  });
});
