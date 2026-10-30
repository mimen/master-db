import { describe, expect, test } from "bun:test";
import type { FunctionReturnType } from "convex/server";

import type { commaApi } from "./convex-api";
import { rowAfter } from "./conversation-state";

type Row = FunctionReturnType<typeof commaApi.listConversations>["page"][number];

const row = (overrides: Partial<Row> = {}): Row => ({
  _id: "conv-1", primaryChatGuid: "iMessage;-;+1", lastMessageAt: 100, unreadCount: 2,
  lastMessage: { guid: "m1", text: "hi", dateCreated: 100, isFromMe: false, senderName: null, hasAttachments: false },
  flags: { unresponded: true, waiting: false, unread: true, mutedUnresponded: false, pinned: false },
  ...overrides,
} as Row);

describe("rowAfter", () => {
  test("a read at or after the last message zeroes the count and the dot, as Convex will", () => {
    expect(rowAfter.read(row(), 100)).toMatchObject({ unreadCount: 0, flags: { unread: false } });
    expect(rowAfter.read(row(), 99), "an older read leaves a later message unread").toMatchObject({ unreadCount: 2, flags: { unread: true } });
  });

  test("a settle on a message that is no longer the last one changes nothing, since Convex will reject it", () => {
    const listed = row();
    expect(rowAfter.settle(listed, "m0")).toBe(listed);
    expect(rowAfter.settle(listed, "m1").flags).toMatchObject({ unresponded: false, waiting: false });
  });

  test("an un-settle puts the conversation back where its last message says", () => {
    const settled = row({ flags: { ...row().flags, unresponded: false } });
    expect(rowAfter.unsettle(settled).flags).toMatchObject({ unresponded: true, waiting: false });
    const mine = row({ lastMessage: { ...row().lastMessage!, isFromMe: true }, flags: { ...row().flags, unresponded: false } });
    expect(rowAfter.unsettle(mine).flags).toMatchObject({ unresponded: false, waiting: true });
  });

  test("pin and mark unread set their flags", () => {
    expect(rowAfter.pin(row(), true).flags.pinned).toBe(true);
    expect(rowAfter.markUnread(row({ unreadCount: 0, flags: { ...row().flags, unread: false } })).flags.unread).toBe(true);
  });
});
