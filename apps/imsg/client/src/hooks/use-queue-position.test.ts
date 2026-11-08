import { expect, test } from "bun:test";
import type { ChatSummary, ConversationId } from "@shared/types";
import { advanceTarget, queueOrder, queuePosition } from "./use-queue-position";

const cid = (id: string) => id as ConversationId;

function chat(id: string, at: number, extra: Partial<ChatSummary> = {}): ChatSummary {
  return {
    conversationId: cid(id), route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: `iMessage;-;${id}` } }, displayName: id, kind: "dm", isGroup: false, known: true, isSpam: false, participants: [], unreadCount: 0,
    lastMessage: { guid: `${id}-m`, text: "", dateCreated: at, isFromMe: false, senderName: null, hasAttachments: false },
    flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    ...extra,
  };
}

const pinned = chat("pinned", 1, { flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: true } });
const priority = chat("priority", 2, { crm: { priority: 1 } as ChatSummary["crm"] });
const order = queueOrder([chat("old", 3), chat("new", 9), priority, pinned]);

test("lens order puts pinned, then priority, then newest first", () => {
  expect(order.map((c) => c.conversationId)).toEqual(["pinned", "priority", "new", "old"].map(cid));
});

test("advance goes to the next conversation, or back from the last", () => {
  expect(advanceTarget(order, cid("priority"))?.conversationId).toBe(cid("new"));
  expect(advanceTarget(order, cid("old"))?.conversationId).toBe(cid("new"));
  expect(advanceTarget([order[0]!], cid("pinned"))).toBeNull();
  expect(advanceTarget(order, cid("elsewhere"))).toBeNull();
});

test("position is one-based and absent outside the lens", () => {
  expect(queuePosition(order, cid("new"))).toEqual({ index: 3, total: 4, conversationId: cid("new") });
  expect(queuePosition(order, cid("elsewhere"))).toBeNull();
  expect(queuePosition(order, undefined)).toBeNull();
});
