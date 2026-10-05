import { expect, test } from "bun:test";
import type { ChatSummary } from "@shared/types";
import { advanceTarget, queueOrder, queuePosition } from "./use-queue-position";

function chat(guid: string, at: number, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    guid, displayName: guid, isGroup: false, known: true, isSpam: false, participants: [], unreadCount: 0,
    lastMessage: { guid: `${guid}-m`, text: "", dateCreated: at, isFromMe: false, senderName: null, hasAttachments: false },
    flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    ...extra,
  };
}

const pinned = chat("pinned", 1, { flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: true } });
const priority = chat("priority", 2, { crm: { priority: 1 } as ChatSummary["crm"] });
const order = queueOrder([chat("old", 3), chat("new", 9), priority, pinned]);

test("lens order puts pinned, then priority, then newest first", () => {
  expect(order.map((c) => c.guid)).toEqual(["pinned", "priority", "new", "old"]);
});

test("advance goes to the next conversation, or back from the last", () => {
  expect(advanceTarget(order, "priority")?.guid).toBe("new");
  expect(advanceTarget(order, "old")?.guid).toBe("new");
  expect(advanceTarget([order[0]!], "pinned")).toBeNull();
  expect(advanceTarget(order, "elsewhere")).toBeNull();
});

test("position is one-based and absent outside the lens", () => {
  expect(queuePosition(order, "new")).toEqual({ index: 3, total: 4 });
  expect(queuePosition(order, "elsewhere")).toBeNull();
  expect(queuePosition(order, undefined)).toBeNull();
});
