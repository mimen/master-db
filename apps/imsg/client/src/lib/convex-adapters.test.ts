import { describe, expect, test } from "bun:test";

import type { Message } from "@shared/types";

import {
  attachmentSource,
  conversationToChat,
  mergeConvexMessages,
  messageToMessage,
  withAgents,
  withDrafts,
  type ConvexConversation,
  type ConvexMessage,
} from "./convex-adapters";
import type { AgentChatSummary } from "./agent-api";

const flags = { unresponded: true, waiting: false, unread: true, pinned: true, mutedUnresponded: false, archived: false };

function conversation(overrides: Partial<ConvexConversation> = {}): ConvexConversation {
  return {
    _id: "c1",
    _creationTime: 1,
    conversationKey: "dm:+15550001111",
    primaryChatGuid: "iMessage;-;+15550001111",
    chatGuids: ["iMessage;-;+15550001111", "SMS;-;+15550001111"],
    displayName: "Alex",
    isGroup: false,
    participants: [{ address: "+15550001111", name: "Alex" }],
    lastMessage: { guid: "m1", text: "hi", dateCreated: 10, isFromMe: false, senderName: "Alex", hasAttachments: false },
    lastMessageAt: 10,
    isSpam: false,
    hasGroupPhoto: false,
    updatedAt: 10,
    flags,
    unreadCount: 3,
    ...overrides,
  } as ConvexConversation;
}

function message(overrides: Partial<ConvexMessage> = {}): ConvexMessage {
  return {
    _id: "row1",
    _creationTime: 1,
    guid: "m1",
    conversationId: "c1",
    chatGuid: "iMessage;-;+15550001111",
    dateCreated: 10,
    isFromMe: false,
    text: "hi",
    service: "iMessage",
    error: 0,
    edited: false,
    retracted: false,
    isTapback: false,
    reactions: [],
    isGroupEvent: false,
    mentions: [],
    attachmentGuids: [],
    sourceVersion: 1,
    attachments: [],
    ...overrides,
  } as ConvexMessage;
}

const attachment = {
  _id: "a",
  _creationTime: 1,
  messageGuid: "m1",
  conversationId: "c1",
  isSticker: false,
  hideAttachment: false,
  sourceVersion: 1,
  thumbUrl: null,
  originalUrl: null,
};

describe("conversationToChat", () => {
  test("keys REST calls by the primary chat guid and keeps the conversation id", () => {
    const chat = conversationToChat(conversation());
    expect(chat.guid).toBe("iMessage;-;+15550001111");
    expect(chat.conversationId).toBe("c1");
    expect(chat.known).toBe(true);
    expect(chat.flags.pinned).toBe(true);
  });

  test("preserves Convex flags and unread counts, including a manual unread mark", () => {
    const row = conversation();
    const chat = conversationToChat(row);
    expect(chat.unreadCount).toBe(3);
    expect(chat.flags).toEqual(flags);
    const manuallyUnread = conversationToChat(conversation({ unreadCount: 0 }));
    expect(manuallyUnread.unreadCount).toBe(0);
    expect(manuallyUnread.flags.unread).toBe(true);
  });

  test("carries the CRM projection only when the view sends one", () => {
    const crm = { is_favorite: true, priority: 2, tags: ["showcase"] };
    expect(conversationToChat({ ...conversation(), crm }).crm).toEqual(crm);
    expect("crm" in conversationToChat(conversation())).toBe(false);
  });
});

describe("withDrafts", () => {
  test("marks exactly the conversations that have a draft and leaves the rest untouched", () => {
    const drafted = conversationToChat(conversation());
    const other = conversationToChat(conversation({ _id: "c2" as never, primaryChatGuid: "iMessage;-;+15550002222" }));
    const [marked, untouched] = withDrafts([drafted, other], [
      { conversationId: "c1" as never, text: "hi", updatedAt: 5, source: "agent", note: "context", attachmentCount: 2 },
    ]);
    expect(marked?.draft).toEqual({ text: "hi", updatedAt: 5, source: "agent", note: "context", attachmentCount: 2 });
    expect(untouched).toBe(other);
  });
});

describe("withAgents", () => {
  const summary = (overrides: Partial<AgentChatSummary>): AgentChatSummary => ({
    _id: "chat-1" as never, conversationId: "c1" as never, title: "Guest list", state: "idle", model: "claude-opus-5-5", effort: "high",
    createdAt: 1, updatedAt: 10, lastTurnEndedAt: 10, seenAt: 20, ...overrides,
  });
  const alex = conversationToChat(conversation());
  const blake = conversationToChat(conversation({ _id: "c2" as never, primaryChatGuid: "iMessage;-;+15550002222" }));

  test("summarizes a conversation by its most urgent unsettled chat and leaves the rest untouched", () => {
    const [joined, untouched] = withAgents([alex, blake], [
      summary({ _id: "open" as never, updatedAt: 30 }),
      summary({ _id: "asking" as never, state: "waiting_input", updatedAt: 20, preview: { kind: "question", text: "Which list?" } }),
      summary({ _id: "closed" as never, state: "waiting_input", settledAt: 25, updatedAt: 40 }),
    ], []);
    expect(joined?.agent).toEqual({ attention: "needs_you", chatId: "asking", title: "Guest list", preview: { kind: "question", text: "Which list?" }, openCount: 2, activityAt: 20 });
    expect(untouched).toBe(blake);
  });

  test("hands back the previous row when the same summaries arrive again, and a new row only where a chat moved", () => {
    const summaries = () => [summary({}), summary({ _id: "chat-2" as never, conversationId: "c2" as never })];
    const first = withAgents([alex, blake], summaries(), []);
    const again = withAgents([alex, blake], summaries(), first);
    expect(again).toBe(first);
    const moved = withAgents([alex, blake], [summary({}), summary({ _id: "chat-2" as never, conversationId: "c2" as never, state: "running" })], again);
    expect(moved[0]).toBe(first[0]!);
    expect(moved[1]?.agent?.attention).toBe("working");
  });

  test("a changed conversation row is not mistaken for its previous join", () => {
    const first = withAgents([alex], [summary({})], []);
    const renamed = { ...alex, displayName: "Alex R" };
    expect(withAgents([renamed], [summary({})], first)[0]?.displayName).toBe("Alex R");
  });
});

describe("messageToMessage", () => {
  test("prefers the on-disk JPEG copy over its missing HEIC original", () => {
    const row = message({
      attachments: [
        { ...attachment, guid: "heic", transferName: "IMG.HEIC", mimeType: "image/heic", isOnDisk: false },
        { ...attachment, guid: "jpg", transferName: "IMG.HEIC.jpeg", mimeType: "image/jpeg", isOnDisk: true },
      ],
    } as Partial<ConvexMessage>);
    expect(messageToMessage(row).attachments.map((a) => a.guid)).toEqual(["jpg"]);
  });

  test("drops hidden attachments and maps nullable fields", () => {
    const row = message({
      attachments: [{ ...attachment, guid: "x", hideAttachment: true, isOnDisk: true }],
    } as Partial<ConvexMessage>);
    const mapped = messageToMessage(row);
    expect(mapped.attachments).toEqual([]);
    expect(mapped.dateRead).toBeNull();
    expect(mapped.sender).toBeNull();
  });
});

describe("attachmentSource", () => {
  const summary = { guid: "a", mimeType: "image/jpeg", filename: null, width: null, height: null, totalBytes: null };
  test("uses Convex URLs when present and the REST route otherwise", () => {
    expect(attachmentSource({ ...summary, thumbUrl: "https://t", originalUrl: "https://o" }, "/rest", true)).toBe("https://t");
    expect(attachmentSource({ ...summary, thumbUrl: null, originalUrl: "https://o" }, "/rest", true)).toBe("https://o");
    expect(attachmentSource({ ...summary, thumbUrl: null, originalUrl: null }, "/rest")).toBe("/rest");
  });
});

describe("mergeConvexMessages", () => {
  const remote = (guid: string, at: number, clientKey?: string): Message =>
    ({ ...messageToMessage(message({ guid, dateCreated: at })), clientKey }) as Message;

  test("keeps a pending local send until its echo arrives, then shows it once", () => {
    const pending = { ...remote("temp-1", 20, "temp-1"), pending: true };
    expect(mergeConvexMessages([remote("m1", 10)], [pending]).map((m) => m.guid)).toEqual(["m1", "temp-1"]);
    const echoed = mergeConvexMessages([remote("m1", 10), remote("real-1", 21, "temp-1")], [pending]);
    expect(echoed.map((m) => m.guid)).toEqual(["m1", "real-1"]);
    expect(echoed[1]?.clientKey).toBe("temp-1");
  });
});

describe("queued sends", () => {
  test("an optimistic outbox row reads as pending, and as failed once the bridge reports it", () => {
    const temp = message({ guid: "temp-k1", isFromMe: true, clientKey: "k1", sourceVersion: 0 } as Partial<ConvexMessage>);
    expect(messageToMessage(temp).pending).toBe(true);
    expect(messageToMessage({ ...temp, error: 1 }).failed).toBe(true);
    expect(messageToMessage(message()).pending).toBeUndefined();
  });
});

describe("queued send dedupe", () => {
  test("the Convex temp row and the local bubble for one send render once", () => {
    const local = { ...messageToMessage(message({ guid: "temp-1", isFromMe: true, dateCreated: 20 })), clientKey: "temp-1", pending: true } as Message;
    const convexTemp = messageToMessage(message({ guid: "temp-temp-1", isFromMe: true, clientKey: "temp-1", dateCreated: 20 } as Partial<ConvexMessage>));
    const merged = mergeConvexMessages([convexTemp], [local]);
    expect(merged.map((m) => m.guid)).toEqual(["temp-1"]);
  });

  test("a settled send renders once when the echo carries no clientKey and the temp row lingers", () => {
    // Production: BlueBubbles echoes omit tempGuid, so the mirrored real row has no clientKey,
    // while the composer settled its local bubble to the real guid from the send result.
    const settled = { ...messageToMessage(message({ guid: "REAL", isFromMe: true, dateCreated: 21 })), clientKey: "temp-1" } as Message;
    const convexTemp = messageToMessage(message({ guid: "temp-temp-1", isFromMe: true, clientKey: "temp-1", dateCreated: 20 } as Partial<ConvexMessage>));
    const echo = messageToMessage(message({ guid: "REAL", isFromMe: true, dateCreated: 21 }));
    const merged = mergeConvexMessages([convexTemp, echo], [settled]);
    expect(merged.map((m) => m.guid)).toEqual(["REAL"]);
  });
});

describe("a burst of sends resolving one at a time", () => {
  // Each send is queued at about 5s; the bridge sends them in turn, and iMessage stamps each with
  // the time it went out. X arrives before the first send goes out, Y between the first and the second.
  const row = (guid: string, text: string, dateCreated: number, extra: Partial<ConvexMessage> = {}) =>
    messageToMessage(message({ guid, text, dateCreated, ...extra }));
  const older = row("m0", "see you at 8", 1_000);
  const x = row("in-x", "X", 5_500);
  const y = row("in-y", "Y", 6_500);
  const queuedAt = { a: 5_000, b: 5_100, c: 5_200 };
  const sentAt = { a: 6_000, b: 7_000, c: 8_000 };
  type Key = keyof typeof queuedAt;
  const temp = (key: Key, error = 0) => row(`temp-temp-${key}`, key, queuedAt[key], { isFromMe: true, clientKey: `temp-${key}`, error });
  const real = (key: Key) => row(`out-${key}`, key, sentAt[key], { isFromMe: true });
  const local = (key: Key): Message => ({ ...row(`temp-${key}`, key, queuedAt[key], { isFromMe: true }), clientKey: `temp-${key}`, pending: true });
  const failed = (key: Key): Message => ({ ...local(key), pending: false, failed: true });
  const settled = (key: Key): Message => ({ ...real(key), clientKey: `temp-${key}` });
  const thread = (remote: Message[], own: Message[]) => mergeConvexMessages(remote, own).map((m) => `${m.text}${m.failed ? "!" : m.pending ? "…" : ""}`);

  test("a send that lands stays above the sends still queued behind it", () => {
    expect(thread([older, temp("a"), temp("b"), temp("c")], [local("a"), local("b"), local("c")]))
      .toEqual(["see you at 8", "a…", "b…", "c…"]);
    expect(thread([older, real("a"), temp("b"), temp("c")], [settled("a"), local("b"), local("c")]))
      .toEqual(["see you at 8", "a", "b…", "c…"]);
    expect(thread([older, real("a"), real("b"), temp("c")], [settled("a"), settled("b"), local("c")]))
      .toEqual(["see you at 8", "a", "b", "c…"]);
  });

  test("a message that arrives mid-burst sits above the sends still queued", () => {
    expect(thread([older, x, temp("a"), temp("b"), temp("c")], [local("a"), local("b"), local("c")]))
      .toEqual(["see you at 8", "X", "a…", "b…", "c…"]);
    expect(thread([older, x, real("a"), y, temp("b"), temp("c")], [settled("a"), local("b"), local("c")]))
      .toEqual(["see you at 8", "X", "a", "Y", "b…", "c…"]);
  });

  test("a failed send keeps its place in the queue and stays below what lands after it", () => {
    expect(thread([older, x, real("a"), temp("b", 1), temp("c")], [settled("a"), failed("b"), local("c")]))
      .toEqual(["see you at 8", "X", "a", "b!", "c…"]);
    expect(thread([older, x, real("a"), temp("b", 1), real("c")], [settled("a"), failed("b"), settled("c")]))
      .toEqual(["see you at 8", "X", "a", "c", "b!"]);
  });

  test("once every send lands the thread is in iMessage's order", () => {
    expect(thread([older, x, real("a"), y, real("b"), real("c")], [settled("a"), settled("b"), settled("c")]))
      .toEqual(["see you at 8", "X", "a", "Y", "b", "c"]);
    expect(thread([older, x, real("a"), y, real("b"), real("c")], [])).toEqual(["see you at 8", "X", "a", "Y", "b", "c"]);
  });
});
